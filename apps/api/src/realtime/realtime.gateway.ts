import { Logger, UnauthorizedException } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { JwtService } from "@nestjs/jwt";
import {
  ConnectedSocket,
  MessageBody,
  OnGatewayConnection,
  OnGatewayDisconnect,
  SubscribeMessage,
  WebSocketGateway,
  WebSocketServer,
} from "@nestjs/websockets";
import { projectRoom, userRoom, type PresenceUpdatePayload } from "@workflo/shared";
import type { Server, Socket } from "socket.io";
import type { EnvConfig } from "../config/env.validation.js";
import { PrismaService } from "../prisma/prisma.service.js";
import type { JwtPayload } from "../auth/strategies/jwt.strategy.js";

interface JoinLeaveProjectPayload {
  projectId: string;
}

/**
 * Real-time gateway (ADR-0003). Handshake-authenticated with the same JWT
 * used for REST (`handshake.auth.token`, falling back to the `Authorization`
 * header) — verified once at connect time; NOT re-validated for the life of
 * the socket (accepted trade-off for MVP, see CLAUDE.md follow-ups).
 *
 * Room authorization (`joinProject`) is the critical security boundary: a
 * socket may only join `project:{id}` if its authenticated user is a member
 * of that project's workspace. `RealtimeListener` (packages this module
 * exports `server` to) is the only thing that broadcasts domain events into
 * these rooms.
 *
 * Every authenticated socket ALSO auto-joins its own `user:{id}` room on
 * connect (no explicit opt-in needed, unlike `project:{id}`) — this is where
 * `NotificationsProcessor` pushes `notification.created`.
 */
@WebSocketGateway({
  cors: {
    origin: (_origin, callback) => callback(null, true),
    credentials: true,
  },
})
export class RealtimeGateway implements OnGatewayConnection, OnGatewayDisconnect {
  private readonly logger = new Logger(RealtimeGateway.name);

  @WebSocketServer()
  server!: Server;

  constructor(
    private readonly jwtService: JwtService,
    private readonly config: ConfigService<EnvConfig, true>,
    private readonly prisma: PrismaService,
  ) {}

  async handleConnection(socket: Socket): Promise<void> {
    try {
      const token = this.extractToken(socket);
      if (!token) {
        throw new UnauthorizedException("Missing auth token");
      }

      const payload = await this.jwtService.verifyAsync<JwtPayload>(token, {
        secret: this.config.get("JWT_ACCESS_SECRET", { infer: true }),
      });

      socket.data.userId = payload.sub;
      socket.data.email = payload.email;
      // Every authenticated socket auto-joins its own user room so the
      // notification worker can push notification.created live without the
      // client having to opt in (unlike project rooms, which are membership-gated).
      await socket.join(userRoom(payload.sub));
    } catch (err) {
      this.logger.warn(`Rejecting socket connection: ${(err as Error).message}`);
      socket.emit("error", { message: "Unauthorized" });
      socket.disconnect(true);
    }
  }

  async handleDisconnect(socket: Socket): Promise<void> {
    const rooms = [...socket.rooms].filter((room) => room.startsWith("project:"));
    for (const room of rooms) {
      const projectId = room.slice("project:".length);
      await this.broadcastPresence(projectId);
    }
  }

  @SubscribeMessage("joinProject")
  async onJoinProject(
    @ConnectedSocket() socket: Socket,
    @MessageBody() body: JoinLeaveProjectPayload,
  ): Promise<void> {
    const userId: string | undefined = socket.data.userId;
    if (!userId) {
      socket.emit("error", { message: "Unauthorized" });
      return;
    }

    const projectId = body?.projectId;
    if (!projectId) {
      socket.emit("error", { message: "projectId is required" });
      return;
    }

    const isMember = await this.isProjectMember(projectId, userId);
    if (!isMember) {
      socket.emit("error", { message: "Not a member of this project's workspace" });
      return;
    }

    await socket.join(projectRoom(projectId));
    await this.broadcastPresence(projectId);
  }

  @SubscribeMessage("leaveProject")
  async onLeaveProject(
    @ConnectedSocket() socket: Socket,
    @MessageBody() body: JoinLeaveProjectPayload,
  ): Promise<void> {
    const projectId = body?.projectId;
    if (!projectId) return;

    await socket.leave(projectRoom(projectId));
    await this.broadcastPresence(projectId);
  }

  /** Derives the distinct set of userIds currently in `project:{id}` (cross-pod via the Redis adapter) and broadcasts it. */
  private async broadcastPresence(projectId: string): Promise<void> {
    const room = projectRoom(projectId);
    const sockets = await this.server.in(room).fetchSockets();
    const userIds = [...new Set(sockets.map((s) => s.data.userId as string).filter(Boolean))];

    const payload: PresenceUpdatePayload = { projectId, userIds };
    this.server.to(room).emit("presence.update", payload);
  }

  private async isProjectMember(projectId: string, userId: string): Promise<boolean> {
    const project = await this.prisma.project.findUnique({
      where: { id: projectId },
      select: { workspaceId: true },
    });
    if (!project) {
      return false;
    }

    const membership = await this.prisma.workspaceMember.findUnique({
      where: { workspaceId_userId: { workspaceId: project.workspaceId, userId } },
    });
    return !!membership;
  }

  private extractToken(socket: Socket): string | undefined {
    const authToken = socket.handshake.auth?.token as string | undefined;
    if (authToken) {
      return authToken;
    }

    const header = socket.handshake.headers.authorization;
    if (header?.startsWith("Bearer ")) {
      return header.slice("Bearer ".length);
    }

    return undefined;
  }
}
