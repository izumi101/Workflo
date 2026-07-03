import { Test } from "@nestjs/testing";
import { ConfigService } from "@nestjs/config";
import { JwtService } from "@nestjs/jwt";
import { RealtimeGateway } from "./realtime.gateway.js";
import { PrismaService } from "../prisma/prisma.service.js";

/**
 * Unit tests for the gateway's security-critical bits: handshake auth
 * (reject missing/invalid token) and joinProject's workspace-membership
 * check (reject non-members, accept members). Socket.IO internals
 * (join/leave/emit/fetchSockets) are stubbed — this only exercises
 * RealtimeGateway's own logic, not the transport.
 */
describe("RealtimeGateway", () => {
  let gateway: RealtimeGateway;
  let jwtService: { verifyAsync: jest.Mock };
  let prismaMock: {
    project: { findUnique: jest.Mock };
    workspaceMember: { findUnique: jest.Mock };
  };

  beforeEach(async () => {
    jwtService = { verifyAsync: jest.fn() };
    prismaMock = {
      project: { findUnique: jest.fn() },
      workspaceMember: { findUnique: jest.fn() },
    };

    const configMock = {
      get: jest.fn().mockReturnValue("test-secret"),
    };

    const moduleRef = await Test.createTestingModule({
      providers: [
        RealtimeGateway,
        { provide: JwtService, useValue: jwtService },
        { provide: ConfigService, useValue: configMock },
        { provide: PrismaService, useValue: prismaMock },
      ],
    }).compile();

    gateway = moduleRef.get(RealtimeGateway);
    // Fake `server` so broadcastPresence (called from joinProject/leaveProject/disconnect) doesn't blow up.
    (gateway as any).server = {
      in: jest.fn().mockReturnValue({ fetchSockets: jest.fn().mockResolvedValue([]) }),
      to: jest.fn().mockReturnValue({ emit: jest.fn() }),
    };
  });

  function fakeSocket(overrides: Record<string, unknown> = {}) {
    const rooms = new Set<string>();
    return {
      id: "socket_1",
      data: {},
      handshake: { auth: {}, headers: {} },
      rooms,
      join: jest.fn(async (room: string) => {
        rooms.add(room);
      }),
      leave: jest.fn(async (room: string) => {
        rooms.delete(room);
      }),
      emit: jest.fn(),
      disconnect: jest.fn(),
      ...overrides,
    } as any;
  }

  describe("handleConnection — handshake auth", () => {
    it("rejects a connection with no token at all", async () => {
      const socket = fakeSocket();

      await gateway.handleConnection(socket);

      expect(jwtService.verifyAsync).not.toHaveBeenCalled();
      expect(socket.emit).toHaveBeenCalledWith("error", { message: "Unauthorized" });
      expect(socket.disconnect).toHaveBeenCalledWith(true);
    });

    it("rejects a connection with an invalid/expired token", async () => {
      jwtService.verifyAsync.mockRejectedValue(new Error("jwt expired"));
      const socket = fakeSocket({ handshake: { auth: { token: "bad-token" }, headers: {} } });

      await gateway.handleConnection(socket);

      expect(socket.emit).toHaveBeenCalledWith("error", { message: "Unauthorized" });
      expect(socket.disconnect).toHaveBeenCalledWith(true);
      expect(socket.data.userId).toBeUndefined();
    });

    it("accepts a valid token from handshake.auth.token and stores userId/email", async () => {
      jwtService.verifyAsync.mockResolvedValue({ sub: "user_1", email: "a@example.com" });
      const socket = fakeSocket({ handshake: { auth: { token: "good-token" }, headers: {} } });

      await gateway.handleConnection(socket);

      expect(socket.disconnect).not.toHaveBeenCalled();
      expect(socket.data.userId).toBe("user_1");
      expect(socket.data.email).toBe("a@example.com");
    });

    it("falls back to the Authorization header when handshake.auth.token is absent", async () => {
      jwtService.verifyAsync.mockResolvedValue({ sub: "user_2", email: "b@example.com" });
      const socket = fakeSocket({
        handshake: { auth: {}, headers: { authorization: "Bearer header-token" } },
      });

      await gateway.handleConnection(socket);

      expect(jwtService.verifyAsync).toHaveBeenCalledWith("header-token", expect.anything());
      expect(socket.data.userId).toBe("user_2");
    });
  });

  describe("onJoinProject — workspace membership authorization", () => {
    it("rejects a non-member: does not join the room and emits an error", async () => {
      const socket = fakeSocket({ data: { userId: "user_1" } });
      prismaMock.project.findUnique.mockResolvedValue({ workspaceId: "ws_1" });
      prismaMock.workspaceMember.findUnique.mockResolvedValue(null);

      await gateway.onJoinProject(socket, { projectId: "proj_1" });

      expect(socket.join).not.toHaveBeenCalled();
      expect(socket.emit).toHaveBeenCalledWith("error", expect.objectContaining({ message: expect.any(String) }));
    });

    it("rejects when the project doesn't exist", async () => {
      const socket = fakeSocket({ data: { userId: "user_1" } });
      prismaMock.project.findUnique.mockResolvedValue(null);

      await gateway.onJoinProject(socket, { projectId: "ghost_proj" });

      expect(socket.join).not.toHaveBeenCalled();
      expect(prismaMock.workspaceMember.findUnique).not.toHaveBeenCalled();
      expect(socket.emit).toHaveBeenCalledWith("error", expect.anything());
    });

    it("joins the room for an authenticated member", async () => {
      const socket = fakeSocket({ data: { userId: "user_1" } });
      prismaMock.project.findUnique.mockResolvedValue({ workspaceId: "ws_1" });
      prismaMock.workspaceMember.findUnique.mockResolvedValue({ role: "MEMBER" });

      await gateway.onJoinProject(socket, { projectId: "proj_1" });

      expect(socket.join).toHaveBeenCalledWith("project:proj_1");
    });

    it("rejects an unauthenticated socket (no userId) even before checking membership", async () => {
      const socket = fakeSocket({ data: {} });

      await gateway.onJoinProject(socket, { projectId: "proj_1" });

      expect(prismaMock.project.findUnique).not.toHaveBeenCalled();
      expect(socket.join).not.toHaveBeenCalled();
      expect(socket.emit).toHaveBeenCalledWith("error", { message: "Unauthorized" });
    });
  });
});
