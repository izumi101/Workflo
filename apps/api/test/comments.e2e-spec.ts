import { INestApplication } from "@nestjs/common";
import { Test } from "@nestjs/testing";
import cookieParser from "cookie-parser";
import request from "supertest";
import { io, type Socket } from "socket.io-client";
import { AppModule } from "../src/app.module.js";
import { PrismaService } from "../src/prisma/prisma.service.js";
import { RedisIoAdapter } from "../src/realtime/redis-io.adapter.js";

/**
 * End-to-end Comments CRUD + mentions + realtime flow (roadmap 0.1 part A)
 * against REAL Postgres + Redis (from docker-compose). Mirrors
 * test/issues.e2e-spec.ts's fixture style and test/realtime.e2e-spec.ts's
 * socket pattern:
 *  - User A (OWNER) creates a workspace + project + issue, adds User B
 *    (MEMBER). User C stays a non-member.
 *  - A comments on the issue mentioning B -> list shows it with author
 *    summary and the mention.
 *  - B edits their own comment (200); B 403s editing A's comment.
 *  - C (non-member) 403s listing/creating comments on the issue.
 *  - Mentioning a non-member userId 400s.
 *  - B deletes their own comment (200); B 403s deleting A's comment;
 *    A (OWNER) deletes B's comment (200).
 *  - A connected member socket in the project room receives `comment.added`
 *    with the exact shared-schema payload shape when A posts a comment.
 */
describe("Comments (e2e)", () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let baseUrl: string;

  const userAEmail = `e2e_commentsA_${Date.now()}@example.com`;
  const userBEmail = `e2e_commentsB_${Date.now()}@example.com`;
  const userCEmail = `e2e_commentsC_${Date.now()}@example.com`;
  const password = "supersecret123";

  let tokenA: string;
  let tokenB: string;
  let tokenC: string;
  let userAId: string;
  let userBId: string;
  let workspaceId: string;
  let projectId: string;
  let projectKey: string;
  let issueKey: string;

  let commentByAId: string;

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
      .send({ email: userAEmail, password, name: "Comments User A" })
      .expect(201);
    tokenA = regA.body.accessToken;
    userAId = regA.body.user.id;

    const regB = await request(app.getHttpServer())
      .post("/api/v1/auth/register")
      .send({ email: userBEmail, password, name: "Comments User B" })
      .expect(201);
    tokenB = regB.body.accessToken;
    userBId = regB.body.user.id;

    const regC = await request(app.getHttpServer())
      .post("/api/v1/auth/register")
      .send({ email: userCEmail, password, name: "Comments User C (non-member)" })
      .expect(201);
    tokenC = regC.body.accessToken;

    const ws = await request(app.getHttpServer())
      .post("/api/v1/workspaces")
      .set("Authorization", authHeader(tokenA))
      .send({ name: `Comments E2E Workspace ${Date.now()}` })
      .expect(201);
    workspaceId = ws.body.id;

    projectKey = `CM${Date.now().toString().slice(-6)}`;
    const proj = await request(app.getHttpServer())
      .post("/api/v1/projects")
      .set("Authorization", authHeader(tokenA))
      .send({ workspaceId, key: projectKey, name: "Comments E2E Project" })
      .expect(201);
    projectId = proj.body.id;

    // Add B as a MEMBER (A stays OWNER); C is never added.
    await request(app.getHttpServer())
      .post(`/api/v1/workspaces/${workspaceId}/members`)
      .set("Authorization", authHeader(tokenA))
      .send({ email: userBEmail, role: "MEMBER" })
      .expect(201);

    const issueRes = await request(app.getHttpServer())
      .post(`/api/v1/projects/${projectId}/issues`)
      .set("Authorization", authHeader(tokenA))
      .send({ title: "Issue to comment on" })
      .expect(201);
    issueKey = `${projectKey}-${issueRes.body.number}`;
  });

  afterAll(async () => {
    if (prisma && workspaceId) {
      await prisma.comment.deleteMany({ where: { issue: { project: { workspaceId } } } });
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

  it("A posts a comment mentioning B; the list shows it with an author summary and the mention", async () => {
    const res = await request(app.getHttpServer())
      .post(`/api/v1/issues/${issueKey}/comments`)
      .set("Authorization", authHeader(tokenA))
      .send({ body: "Hey @B, take a look", mentionUserIds: [userBId] })
      .expect(201);

    expect(res.body.body).toBe("Hey @B, take a look");
    expect(res.body.mentions).toEqual([userBId]);
    expect(res.body.author).toEqual(
      expect.objectContaining({ id: userAId, name: "Comments User A" }),
    );
    expect(res.body.author).not.toHaveProperty("passwordHash");
    commentByAId = res.body.id;

    const listRes = await request(app.getHttpServer())
      .get(`/api/v1/issues/${issueKey}/comments`)
      .set("Authorization", authHeader(tokenA))
      .expect(200);

    expect(listRes.body.items).toHaveLength(1);
    expect(listRes.body.items[0].id).toBe(commentByAId);
    expect(listRes.body.items[0].author).toEqual(
      expect.objectContaining({ id: userAId, name: "Comments User A" }),
    );
  });

  it("mentioning a userId that is not a workspace member 400s", async () => {
    await request(app.getHttpServer())
      .post(`/api/v1/issues/${issueKey}/comments`)
      .set("Authorization", authHeader(tokenA))
      .send({ body: "Hey @ghost", mentionUserIds: ["clxxxxxxxxxxxxxxxxxxxxxxx"] })
      .expect(400);
  });

  it("C (non-member) 403s listing comments on the issue", async () => {
    await request(app.getHttpServer())
      .get(`/api/v1/issues/${issueKey}/comments`)
      .set("Authorization", authHeader(tokenC))
      .expect(403);
  });

  it("C (non-member) 403s creating a comment on the issue", async () => {
    await request(app.getHttpServer())
      .post(`/api/v1/issues/${issueKey}/comments`)
      .set("Authorization", authHeader(tokenC))
      .send({ body: "Sneaky comment" })
      .expect(403);
  });

  let commentByBId: string;

  it("B creates their own comment", async () => {
    const res = await request(app.getHttpServer())
      .post(`/api/v1/issues/${issueKey}/comments`)
      .set("Authorization", authHeader(tokenB))
      .send({ body: "B's own comment" })
      .expect(201);
    commentByBId = res.body.id;
  });

  it("B edits their own comment (200)", async () => {
    const res = await request(app.getHttpServer())
      .patch(`/api/v1/comments/${commentByBId}`)
      .set("Authorization", authHeader(tokenB))
      .send({ body: "B's edited comment" })
      .expect(200);

    expect(res.body.body).toBe("B's edited comment");
  });

  it("B 403s editing A's comment", async () => {
    await request(app.getHttpServer())
      .patch(`/api/v1/comments/${commentByAId}`)
      .set("Authorization", authHeader(tokenB))
      .send({ body: "Hijacked" })
      .expect(403);
  });

  it("B deletes their own comment (200)", async () => {
    await request(app.getHttpServer())
      .delete(`/api/v1/comments/${commentByBId}`)
      .set("Authorization", authHeader(tokenB))
      .expect(200);
  });

  it("B 403s deleting A's comment", async () => {
    await request(app.getHttpServer())
      .delete(`/api/v1/comments/${commentByAId}`)
      .set("Authorization", authHeader(tokenB))
      .expect(403);
  });

  it("A (OWNER) deletes A's own comment (200) — proves owner delete path via a fresh comment from B", async () => {
    // Create a fresh comment as B, then have A (workspace OWNER, not the
    // author) delete it to prove the owner-delete path.
    const res = await request(app.getHttpServer())
      .post(`/api/v1/issues/${issueKey}/comments`)
      .set("Authorization", authHeader(tokenB))
      .send({ body: "Another B comment for owner-delete" })
      .expect(201);

    await request(app.getHttpServer())
      .delete(`/api/v1/comments/${res.body.id}`)
      .set("Authorization", authHeader(tokenA))
      .expect(200);
  });

  it("a connected member socket in the project room receives comment.added with the exact schema shape when A posts", async () => {
    const socketB = openSocket(tokenB);
    await waitForEvent(socketB, "connect");

    socketB.emit("joinProject", { projectId });
    await waitForEvent(socketB, "presence.update");

    const commentAddedOnB = waitForEvent<Record<string, unknown>>(socketB, "comment.added");

    const res = await request(app.getHttpServer())
      .post(`/api/v1/issues/${issueKey}/comments`)
      .set("Authorization", authHeader(tokenA))
      .send({ body: "Realtime comment from A" })
      .expect(201);

    const payload = await commentAddedOnB;

    expect(payload).toEqual(
      expect.objectContaining({
        id: res.body.id,
        issueId: expect.any(String),
        authorId: userAId,
        body: "Realtime comment from A",
        mentions: [],
        projectId,
        issueKey,
      }),
    );
    expect(payload.createdAt).toBeTruthy();
    expect(payload.updatedAt).toBeTruthy();
    // Exact shape: no embedded author object, no extra wrapper keys.
    expect(payload).not.toHaveProperty("author");
    expect(payload).not.toHaveProperty("comment");
    expect(Object.keys(payload).sort()).toEqual(
      ["authorId", "body", "createdAt", "id", "issueId", "issueKey", "mentions", "projectId", "updatedAt"].sort(),
    );

    socketB.close();
  });
});
