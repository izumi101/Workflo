import { INestApplication } from "@nestjs/common";
import { Test } from "@nestjs/testing";
import cookieParser from "cookie-parser";
import request from "supertest";
import { io, type Socket } from "socket.io-client";
import { AppModule } from "../src/app.module.js";
import { PrismaService } from "../src/prisma/prisma.service.js";
import { RedisIoAdapter } from "../src/realtime/redis-io.adapter.js";

/**
 * End-to-end real-time flow (ADR-0003) against REAL Postgres + Redis (from
 * docker-compose). Mirrors test/issues.e2e-spec.ts's fixture style:
 *  - User A (owner) creates a workspace + project, adds User B as a member.
 *  - Both connect real socket.io-client sockets with their access tokens and
 *    joinProject.
 *  - A REST issue create/move triggers a broadcast that BOTH sockets receive
 *    with the correct payload (including updatedAt).
 *  - A socket with a bad token fails to connect.
 *  - A non-member's joinProject is rejected and it does not receive room events.
 *  - presence.update fires on join.
 */
describe("Realtime (e2e)", () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let baseUrl: string;

  const userAEmail = `e2e_rt_A_${Date.now()}@example.com`;
  const userBEmail = `e2e_rt_B_${Date.now()}@example.com`;
  const userCEmail = `e2e_rt_C_${Date.now()}@example.com`; // non-member
  const password = "supersecret123";

  let tokenA: string;
  let tokenB: string;
  let tokenC: string;
  let workspaceId: string;
  let projectId: string;
  let projectKey: string;

  const authHeader = (token: string) => `Bearer ${token}`;

  const openSocket = (token: string): Socket =>
    io(baseUrl, {
      auth: { token },
      transports: ["websocket"],
      forceNew: true,
      reconnection: false,
    });

  const waitForEvent = <T = any>(socket: Socket, event: string, timeoutMs = 5000): Promise<T> =>
    new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error(`Timed out waiting for "${event}"`)), timeoutMs);
      socket.once(event, (payload: T) => {
        clearTimeout(timer);
        resolve(payload);
      });
    });

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleRef.createNestApplication();
    app.setGlobalPrefix("api/v1");
    app.use(cookieParser());

    const redisIoAdapter = new RedisIoAdapter(app);
    await redisIoAdapter.connectToRedis();
    app.useWebSocketAdapter(redisIoAdapter);

    await app.init();
    await app.listen(0);

    const address = app.getHttpServer().address();
    const port = typeof address === "string" ? address : address?.port;
    baseUrl = `http://127.0.0.1:${port}`;

    prisma = app.get(PrismaService);

    const regA = await request(app.getHttpServer())
      .post("/api/v1/auth/register")
      .send({ email: userAEmail, password, name: "RT User A" })
      .expect(201);
    tokenA = regA.body.accessToken;

    const regB = await request(app.getHttpServer())
      .post("/api/v1/auth/register")
      .send({ email: userBEmail, password, name: "RT User B" })
      .expect(201);
    tokenB = regB.body.accessToken;

    const regC = await request(app.getHttpServer())
      .post("/api/v1/auth/register")
      .send({ email: userCEmail, password, name: "RT User C (non-member)" })
      .expect(201);
    tokenC = regC.body.accessToken;

    const ws = await request(app.getHttpServer())
      .post("/api/v1/workspaces")
      .set("Authorization", authHeader(tokenA))
      .send({ name: `RT E2E Workspace ${Date.now()}` })
      .expect(201);
    workspaceId = ws.body.id;

    projectKey = `RT${Date.now().toString().slice(-6)}`;
    const proj = await request(app.getHttpServer())
      .post("/api/v1/projects")
      .set("Authorization", authHeader(tokenA))
      .send({ workspaceId, key: projectKey, name: "RT E2E Project" })
      .expect(201);
    projectId = proj.body.id;

    // Add B as a member so both A and B can join the project's room.
    await request(app.getHttpServer())
      .post(`/api/v1/workspaces/${workspaceId}/members`)
      .set("Authorization", authHeader(tokenA))
      .send({ email: userBEmail, role: "MEMBER" })
      .expect(201);
  });

  afterAll(async () => {
    if (prisma && workspaceId) {
      await prisma.issue.deleteMany({ where: { project: { workspaceId } } });
      await prisma.project.deleteMany({ where: { workspaceId } });
      await prisma.workspaceMember.deleteMany({ where: { workspaceId } });
      await prisma.workspace.deleteMany({ where: { id: workspaceId } });
    }
    if (prisma) {
      await prisma.user.deleteMany({ where: { email: { in: [userAEmail, userBEmail, userCEmail] } } });
    }
    if (app) await app.close();
  });

  it("rejects a socket connection with a missing/bad token", async () => {
    const badSocket = openSocket("this-is-not-a-valid-jwt");
    // The Socket.IO transport handshake itself succeeds (it happens before
    // our async handleConnection runs); our gateway then verifies the JWT,
    // fails, emits an app-level "error", and disconnects the socket. Assert
    // on that disconnect rather than the transport-level connect outcome.
    const errorEvent = waitForEvent(badSocket, "error");
    const disconnectEvent = new Promise<void>((resolve) => badSocket.once("disconnect", () => resolve()));

    await Promise.all([errorEvent, disconnectEvent]);
    expect(badSocket.connected).toBe(false);
    badSocket.close();
  });

  it("A and B join the project room; presence.update fires with both userIds", async () => {
    const meA = await request(app.getHttpServer())
      .get("/api/v1/auth/me")
      .set("Authorization", authHeader(tokenA))
      .expect(200);
    const userAId = meA.body.id;

    const meB = await request(app.getHttpServer())
      .get("/api/v1/auth/me")
      .set("Authorization", authHeader(tokenB))
      .expect(200);
    const userBId = meB.body.id;

    const socketA = openSocket(tokenA);
    await waitForEvent(socketA, "connect");

    const presenceAfterA = waitForEvent<{ projectId: string; userIds: string[] }>(socketA, "presence.update");
    socketA.emit("joinProject", { projectId });
    const firstPresence = await presenceAfterA;
    expect(firstPresence.projectId).toBe(projectId);
    expect(firstPresence.userIds).toEqual([userAId]);

    const socketB = openSocket(tokenB);
    await waitForEvent(socketB, "connect");

    const presenceAfterB = waitForEvent<{ projectId: string; userIds: string[] }>(socketA, "presence.update");
    socketB.emit("joinProject", { projectId });
    const secondPresence = await presenceAfterB;
    expect(secondPresence.projectId).toBe(projectId);
    expect(new Set(secondPresence.userIds)).toEqual(new Set([userAId, userBId]));

    socketA.close();
    socketB.close();
  });

  it("a non-member's joinProject is rejected and it never receives room events", async () => {
    const socketC = openSocket(tokenC);
    await waitForEvent(socketC, "connect");

    const errorPromise = waitForEvent(socketC, "error");
    socketC.emit("joinProject", { projectId });
    const err = await errorPromise;
    expect(err).toEqual(expect.objectContaining({ message: expect.any(String) }));

    // Prove it does NOT receive room events: create an issue as A right after,
    // and assert C never gets an issue.created within a short window.
    let receivedOnC = false;
    socketC.on("issue.created", () => {
      receivedOnC = true;
    });

    await request(app.getHttpServer())
      .post(`/api/v1/projects/${projectId}/issues`)
      .set("Authorization", authHeader(tokenA))
      .send({ title: "Issue for non-member isolation check" })
      .expect(201);

    await new Promise((resolve) => setTimeout(resolve, 500));
    expect(receivedOnC).toBe(false);

    socketC.close();
  });

  it("BOTH member sockets receive issue.created with the correct payload (incl. updatedAt) when A creates an issue via REST", async () => {
    const socketA = openSocket(tokenA);
    const socketB = openSocket(tokenB);
    await Promise.all([waitForEvent(socketA, "connect"), waitForEvent(socketB, "connect")]);

    socketA.emit("joinProject", { projectId });
    socketB.emit("joinProject", { projectId });
    await Promise.all([waitForEvent(socketA, "presence.update"), waitForEvent(socketB, "presence.update")]);

    const createdOnA = waitForEvent(socketA, "issue.created");
    const createdOnB = waitForEvent(socketB, "issue.created");

    const res = await request(app.getHttpServer())
      .post(`/api/v1/projects/${projectId}/issues`)
      .set("Authorization", authHeader(tokenA))
      .send({ title: "Realtime created issue" })
      .expect(201);

    const [issueOnA, issueOnB] = await Promise.all([createdOnA, createdOnB]);

    expect((issueOnA as any).id).toBe(res.body.id);
    expect((issueOnA as any).title).toBe("Realtime created issue");
    expect((issueOnA as any).updatedAt).toBeTruthy();
    expect((issueOnB as any).id).toBe(res.body.id);
    expect((issueOnB as any).updatedAt).toBeTruthy();

    socketA.close();
    socketB.close();
  });

  it("BOTH member sockets receive issue.moved with the correct payload when A moves the issue via REST", async () => {
    // Create a fresh issue to move.
    const createRes = await request(app.getHttpServer())
      .post(`/api/v1/projects/${projectId}/issues`)
      .set("Authorization", authHeader(tokenA))
      .send({ title: "Issue to move" })
      .expect(201);
    const issueKey = `${projectKey}-${createRes.body.number}`;

    const socketA = openSocket(tokenA);
    const socketB = openSocket(tokenB);
    await Promise.all([waitForEvent(socketA, "connect"), waitForEvent(socketB, "connect")]);

    socketA.emit("joinProject", { projectId });
    socketB.emit("joinProject", { projectId });
    await Promise.all([waitForEvent(socketA, "presence.update"), waitForEvent(socketB, "presence.update")]);

    const movedOnA = waitForEvent(socketA, "issue.moved");
    const movedOnB = waitForEvent(socketB, "issue.moved");

    const moveRes = await request(app.getHttpServer())
      .post(`/api/v1/issues/${issueKey}/move`)
      .set("Authorization", authHeader(tokenA))
      .send({ status: "IN_PROGRESS" })
      .expect(201);

    const [issueOnA, issueOnB] = await Promise.all([movedOnA, movedOnB]);

    expect((issueOnA as any).id).toBe(moveRes.body.id);
    expect((issueOnA as any).status).toBe("IN_PROGRESS");
    expect((issueOnA as any).updatedAt).toBeTruthy();
    expect((issueOnB as any).id).toBe(moveRes.body.id);
    expect((issueOnB as any).status).toBe("IN_PROGRESS");

    socketA.close();
    socketB.close();
  });

  it("leaveProject removes the socket from the room and presence updates accordingly", async () => {
    const socketA = openSocket(tokenA);
    const socketB = openSocket(tokenB);
    await Promise.all([waitForEvent(socketA, "connect"), waitForEvent(socketB, "connect")]);

    socketA.emit("joinProject", { projectId });
    await waitForEvent(socketA, "presence.update");
    socketB.emit("joinProject", { projectId });
    await waitForEvent(socketA, "presence.update");

    const presenceAfterLeave = waitForEvent<{ userIds: string[] }>(socketA, "presence.update");
    socketB.emit("leaveProject", { projectId });
    const presence = await presenceAfterLeave;

    const meA = await request(app.getHttpServer())
      .get("/api/v1/auth/me")
      .set("Authorization", authHeader(tokenA))
      .expect(200);
    expect(presence.userIds).toEqual([meA.body.id]);

    socketA.close();
    socketB.close();
  });
});
