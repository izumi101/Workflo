import { INestApplication } from "@nestjs/common";
import { Test } from "@nestjs/testing";
import cookieParser from "cookie-parser";
import request from "supertest";
import { AppModule } from "../src/app.module.js";
import { PrismaService } from "../src/prisma/prisma.service.js";
import { RedisIoAdapter } from "../src/realtime/redis-io.adapter.js";

/**
 * End-to-end Notifications flow (roadmap 0.4 part A) against REAL Postgres +
 * Redis (from docker-compose), including the REAL BullMQ queue/worker — no
 * mocking of the queue here. Mirrors test/comments.e2e-spec.ts's fixture
 * style:
 *  - User A (OWNER) creates a workspace + project, adds User B (MEMBER).
 *  - A mentions B in a comment -> poll GET /notifications as B until the
 *    MENTION notification appears (BullMQ delivery is async — never assert
 *    synchronously on it).
 *  - unread-count reflects it; mark-read clears it.
 *  - A assigns an issue to B -> B gets an ASSIGNED notification (polled).
 *  - Self-mention and self-assignment produce NO notification for the actor.
 *  - A cannot read/mark-read B's notifications (403/404).
 */
describe("Notifications (e2e)", () => {
  let app: INestApplication;
  let prisma: PrismaService;

  const userAEmail = `e2e_notifA_${Date.now()}@example.com`;
  const userBEmail = `e2e_notifB_${Date.now()}@example.com`;
  const password = "supersecret123";

  let tokenA: string;
  let tokenB: string;
  let userAId: string;
  let userBId: string;
  let workspaceId: string;
  let projectId: string;
  let projectKey: string;

  const authHeader = (token: string) => `Bearer ${token}`;

  /**
   * Polls `GET /notifications` as `token` until a notification matching
   * `predicate` appears, or throws after exhausting a small, deliberately
   * SPARSE set of attempts with growing delays. The BullMQ worker runs
   * in-process but asynchronously — the HTTP response for the triggering
   * mutation returns before the job is necessarily processed, so synchronous
   * assertions would be flaky by construction. Kept sparse (not a tight
   * poll loop) because `GET /notifications` shares ONE rate-limit bucket
   * (tracked by IP, not by user/token — see ThrottlerGuard) across this
   * entire spec file's tests; a tight loop would 429 itself.
   */
  const pollForNotification = async (token: string, predicate: (n: any) => boolean): Promise<any> => {
    const delaysMs = [300, 700, 1200, 2000, 3000];
    for (const delay of delaysMs) {
      const res = await request(app.getHttpServer())
        .get("/api/v1/notifications")
        .set("Authorization", authHeader(token))
        .expect(200);
      const match = res.body.items.find(predicate);
      if (match) return match;
      await new Promise((resolve) => setTimeout(resolve, delay));
    }
    // One last check after the final delay.
    const res = await request(app.getHttpServer())
      .get("/api/v1/notifications")
      .set("Authorization", authHeader(token))
      .expect(200);
    const match = res.body.items.find(predicate);
    if (match) return match;
    throw new Error("Timed out waiting for notification to appear");
  };

  /** Asserts NO notification matching `predicate` appears within a short grace window (proves a no-notify path, not just "not yet"). Uses a single wait + single check, not a loop, to stay well within the shared rate-limit bucket. */
  const assertNeverAppears = async (token: string, predicate: (n: any) => boolean): Promise<void> => {
    await new Promise((resolve) => setTimeout(resolve, 1500));
    const res = await request(app.getHttpServer())
      .get("/api/v1/notifications")
      .set("Authorization", authHeader(token))
      .expect(200);
    if (res.body.items.find(predicate)) {
      throw new Error("Unexpected notification appeared");
    }
  };

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

    prisma = app.get(PrismaService);

    const regA = await request(app.getHttpServer())
      .post("/api/v1/auth/register")
      .send({ email: userAEmail, password, name: "Notif User A" })
      .expect(201);
    tokenA = regA.body.accessToken;
    userAId = regA.body.user.id;

    const regB = await request(app.getHttpServer())
      .post("/api/v1/auth/register")
      .send({ email: userBEmail, password, name: "Notif User B" })
      .expect(201);
    tokenB = regB.body.accessToken;
    userBId = regB.body.user.id;

    const ws = await request(app.getHttpServer())
      .post("/api/v1/workspaces")
      .set("Authorization", authHeader(tokenA))
      .send({ name: `Notif E2E Workspace ${Date.now()}` })
      .expect(201);
    workspaceId = ws.body.id;

    projectKey = `NT${Date.now().toString().slice(-6)}`;
    const proj = await request(app.getHttpServer())
      .post("/api/v1/projects")
      .set("Authorization", authHeader(tokenA))
      .send({ workspaceId, key: projectKey, name: "Notif E2E Project" })
      .expect(201);
    projectId = proj.body.id;

    await request(app.getHttpServer())
      .post(`/api/v1/workspaces/${workspaceId}/members`)
      .set("Authorization", authHeader(tokenA))
      .send({ email: userBEmail, role: "MEMBER" })
      .expect(201);
  });

  afterAll(async () => {
    if (prisma && workspaceId) {
      await prisma.notification.deleteMany({ where: { userId: { in: [userAId, userBId] } } });
      await prisma.comment.deleteMany({ where: { issue: { project: { workspaceId } } } });
      await prisma.issue.deleteMany({ where: { project: { workspaceId } } });
      await prisma.project.deleteMany({ where: { workspaceId } });
      await prisma.workspaceMember.deleteMany({ where: { workspaceId } });
      await prisma.workspace.deleteMany({ where: { id: workspaceId } });
    }
    if (prisma) {
      await prisma.user.deleteMany({ where: { email: { in: [userAEmail, userBEmail] } } });
    }
    if (app) await app.close();
  });

  it("A mentions B in a comment -> B eventually gets a MENTION notification via the real BullMQ queue", async () => {
    const issueRes = await request(app.getHttpServer())
      .post(`/api/v1/projects/${projectId}/issues`)
      .set("Authorization", authHeader(tokenA))
      .send({ title: "Issue for mention notification" })
      .expect(201);
    const issueKey = `${projectKey}-${issueRes.body.number}`;

    const commentRes = await request(app.getHttpServer())
      .post(`/api/v1/issues/${issueKey}/comments`)
      .set("Authorization", authHeader(tokenA))
      .send({ body: "Hey @B check this out", mentionUserIds: [userBId] })
      .expect(201);

    const notif = await pollForNotification(
      tokenB,
      (n) => n.type === "MENTION" && n.payload?.commentId === commentRes.body.id,
    );

    expect(notif.userId).toBe(userBId);
    expect(notif.readAt).toBeNull();
    expect(notif.payload).toEqual(
      expect.objectContaining({
        issueKey,
        projectId,
        actorId: userAId,
        actorName: "Notif User A",
        commentId: commentRes.body.id,
      }),
    );

    // unread-count reflects it.
    const countRes = await request(app.getHttpServer())
      .get("/api/v1/notifications/unread-count")
      .set("Authorization", authHeader(tokenB))
      .expect(200);
    expect(countRes.body.count).toBeGreaterThanOrEqual(1);

    // Mark read.
    const readRes = await request(app.getHttpServer())
      .post(`/api/v1/notifications/${notif.id}/read`)
      .set("Authorization", authHeader(tokenB))
      .expect(201);
    expect(readRes.body.id).toBe(notif.id);
    expect(readRes.body.readAt).toBeTruthy();

    // unread-count (separate rate-limit bucket from list) confirms it's gone from the unread count.
    const countAfterRes = await request(app.getHttpServer())
      .get("/api/v1/notifications/unread-count")
      .set("Authorization", authHeader(tokenB))
      .expect(200);
    expect(countAfterRes.body.count).toBe(countRes.body.count - 1);
  }, 15000);

  it("A assigns an issue to B -> B eventually gets an ASSIGNED notification", async () => {
    const issueRes = await request(app.getHttpServer())
      .post(`/api/v1/projects/${projectId}/issues`)
      .set("Authorization", authHeader(tokenA))
      .send({ title: "Issue for assign notification" })
      .expect(201);
    const issueKey = `${projectKey}-${issueRes.body.number}`;

    await request(app.getHttpServer())
      .patch(`/api/v1/issues/${issueKey}`)
      .set("Authorization", authHeader(tokenA))
      .send({ assigneeId: userBId })
      .expect(200);

    const notif = await pollForNotification(
      tokenB,
      (n) => n.type === "ASSIGNED" && n.payload?.issueKey === issueKey,
    );

    expect(notif.userId).toBe(userBId);
    expect(notif.payload).toEqual(
      expect.objectContaining({
        issueKey,
        projectId,
        actorId: userAId,
        actorName: "Notif User A",
      }),
    );
  }, 15000);

  it("self-mention produces no notification for the author", async () => {
    const issueRes = await request(app.getHttpServer())
      .post(`/api/v1/projects/${projectId}/issues`)
      .set("Authorization", authHeader(tokenA))
      .send({ title: "Issue for self-mention check" })
      .expect(201);
    const issueKey = `${projectKey}-${issueRes.body.number}`;

    const commentRes = await request(app.getHttpServer())
      .post(`/api/v1/issues/${issueKey}/comments`)
      .set("Authorization", authHeader(tokenA))
      .send({ body: "Note to myself @A", mentionUserIds: [userAId] })
      .expect(201);

    await assertNeverAppears(tokenA, (n) => n.payload?.commentId === commentRes.body.id);
  }, 10000);

  it("self-assignment produces no notification for the actor", async () => {
    const issueRes = await request(app.getHttpServer())
      .post(`/api/v1/projects/${projectId}/issues`)
      .set("Authorization", authHeader(tokenA))
      .send({ title: "Issue for self-assign check" })
      .expect(201);
    const issueKey = `${projectKey}-${issueRes.body.number}`;

    await request(app.getHttpServer())
      .patch(`/api/v1/issues/${issueKey}`)
      .set("Authorization", authHeader(tokenA))
      .send({ assigneeId: userAId })
      .expect(200);

    await assertNeverAppears(tokenA, (n) => n.payload?.issueKey === issueKey);
  }, 10000);

  it("A cannot read or mark-read B's notification (403/404)", async () => {
    const issueRes = await request(app.getHttpServer())
      .post(`/api/v1/projects/${projectId}/issues`)
      .set("Authorization", authHeader(tokenA))
      .send({ title: "Issue for cross-user notification isolation" })
      .expect(201);
    const issueKey = `${projectKey}-${issueRes.body.number}`;

    const commentRes = await request(app.getHttpServer())
      .post(`/api/v1/issues/${issueKey}/comments`)
      .set("Authorization", authHeader(tokenA))
      .send({ body: "@B isolation check", mentionUserIds: [userBId] })
      .expect(201);

    const notif = await pollForNotification(
      tokenB,
      (n) => n.type === "MENTION" && n.payload?.commentId === commentRes.body.id,
    );

    // A's own notification list must never contain B's notification.
    const aListRes = await request(app.getHttpServer())
      .get("/api/v1/notifications")
      .set("Authorization", authHeader(tokenA))
      .expect(200);
    expect(aListRes.body.items.find((n: any) => n.id === notif.id)).toBeUndefined();

    // A cannot mark B's notification read.
    await request(app.getHttpServer())
      .post(`/api/v1/notifications/${notif.id}/read`)
      .set("Authorization", authHeader(tokenA))
      .expect(403);

    // A marking a nonexistent notification read gets 404.
    await request(app.getHttpServer())
      .post("/api/v1/notifications/clxxxxxxxxxxxxxxxxxxxxxxx/read")
      .set("Authorization", authHeader(tokenA))
      .expect(404);
  }, 15000);

  it("read-all marks every one of the caller's unread notifications as read", async () => {
    const issueRes = await request(app.getHttpServer())
      .post(`/api/v1/projects/${projectId}/issues`)
      .set("Authorization", authHeader(tokenA))
      .send({ title: "Issue for read-all check" })
      .expect(201);
    const issueKey = `${projectKey}-${issueRes.body.number}`;

    const commentRes = await request(app.getHttpServer())
      .post(`/api/v1/issues/${issueKey}/comments`)
      .set("Authorization", authHeader(tokenA))
      .send({ body: "@B read-all check", mentionUserIds: [userBId] })
      .expect(201);

    await pollForNotification(tokenB, (n) => n.payload?.commentId === commentRes.body.id);

    const readAllRes = await request(app.getHttpServer())
      .post("/api/v1/notifications/read-all")
      .set("Authorization", authHeader(tokenB))
      .expect(201);
    expect(readAllRes.body.count).toBeGreaterThanOrEqual(1);

    const countRes = await request(app.getHttpServer())
      .get("/api/v1/notifications/unread-count")
      .set("Authorization", authHeader(tokenB))
      .expect(200);
    expect(countRes.body.count).toBe(0);
  }, 15000);
});
