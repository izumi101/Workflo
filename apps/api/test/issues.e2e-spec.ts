import { INestApplication } from "@nestjs/common";
import { Test } from "@nestjs/testing";
import cookieParser from "cookie-parser";
import request from "supertest";
import { AppModule } from "../src/app.module.js";
import { PrismaService } from "../src/prisma/prisma.service.js";

/**
 * End-to-end Issues + Labels CRUD flow against a REAL Postgres (from
 * docker-compose, migrated). Uses TWO users to prove workspace membership
 * enforcement, mirroring test/workspaces-projects.e2e-spec.ts:
 *  - User A creates a workspace (OWNER) + project → creates two issues
 *    (proves sequential human-key allocation -1, -2).
 *  - GET by key, PATCH status, filter list by status/assignee.
 *  - Create + attach a label via PATCH labelIds.
 *  - User B (non-member) is 403'd on the project's issues.
 *  - DELETE an issue.
 *
 * Reuses the auth + workspace/project endpoints to set up fixtures.
 */
describe("Issues + Labels (e2e)", () => {
  let app: INestApplication;
  let prisma: PrismaService;

  const userAEmail = `e2e_issuesA_${Date.now()}@example.com`;
  const userBEmail = `e2e_issuesB_${Date.now()}@example.com`;
  const password = "supersecret123";

  let tokenA: string;
  let tokenB: string;
  let workspaceId: string;
  let projectId: string;
  let projectKey: string;
  let issue1Key: string;
  let issue2Key: string;
  let labelId: string;

  const authHeader = (token: string) => `Bearer ${token}`;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleRef.createNestApplication();
    app.setGlobalPrefix("api/v1");
    app.use(cookieParser());
    await app.init();

    prisma = app.get(PrismaService);

    const regA = await request(app.getHttpServer())
      .post("/api/v1/auth/register")
      .send({ email: userAEmail, password, name: "Issues User A" })
      .expect(201);
    tokenA = regA.body.accessToken;

    const regB = await request(app.getHttpServer())
      .post("/api/v1/auth/register")
      .send({ email: userBEmail, password, name: "Issues User B" })
      .expect(201);
    tokenB = regB.body.accessToken;

    const ws = await request(app.getHttpServer())
      .post("/api/v1/workspaces")
      .set("Authorization", authHeader(tokenA))
      .send({ name: `Issues E2E Workspace ${Date.now()}` })
      .expect(201);
    workspaceId = ws.body.id;

    projectKey = `IS${Date.now().toString().slice(-6)}`;
    const proj = await request(app.getHttpServer())
      .post("/api/v1/projects")
      .set("Authorization", authHeader(tokenA))
      .send({ workspaceId, key: projectKey, name: "Issues E2E Project" })
      .expect(201);
    projectId = proj.body.id;
  });

  afterAll(async () => {
    if (prisma && workspaceId) {
      await prisma.issue.deleteMany({ where: { project: { workspaceId } } });
      await prisma.label.deleteMany({ where: { project: { workspaceId } } });
      await prisma.project.deleteMany({ where: { workspaceId } });
      await prisma.workspaceMember.deleteMany({ where: { workspaceId } });
      await prisma.workspace.deleteMany({ where: { id: workspaceId } });
    }
    if (prisma) {
      await prisma.user.deleteMany({ where: { email: { in: [userAEmail, userBEmail] } } });
    }
    if (app) await app.close();
  });

  it("A creates a first issue and gets key <PROJECTKEY>-1", async () => {
    const res = await request(app.getHttpServer())
      .post(`/api/v1/projects/${projectId}/issues`)
      .set("Authorization", authHeader(tokenA))
      .send({ title: "First issue" })
      .expect(201);

    expect(res.body.number).toBe(1);
    expect(res.body.status).toBe("TODO");
    issue1Key = `${projectKey}-1`;
  });

  it("A creates a second issue and gets key <PROJECTKEY>-2 (sequential allocation)", async () => {
    const res = await request(app.getHttpServer())
      .post(`/api/v1/projects/${projectId}/issues`)
      .set("Authorization", authHeader(tokenA))
      .send({ title: "Second issue", priority: "HIGH" })
      .expect(201);

    expect(res.body.number).toBe(2);
    issue2Key = `${projectKey}-2`;
  });

  it("GET /issues/:key returns the first issue by human key", async () => {
    const res = await request(app.getHttpServer())
      .get(`/api/v1/issues/${issue1Key}`)
      .set("Authorization", authHeader(tokenA))
      .expect(200);

    expect(res.body.title).toBe("First issue");
    expect(res.body.number).toBe(1);
  });

  it("GET /issues/:key 404s for a well-formed but nonexistent key", async () => {
    await request(app.getHttpServer())
      .get(`/api/v1/issues/${projectKey}-9999`)
      .set("Authorization", authHeader(tokenA))
      .expect(404);
  });

  it("PATCH /issues/:key moves status TODO -> IN_PROGRESS", async () => {
    const res = await request(app.getHttpServer())
      .patch(`/api/v1/issues/${issue1Key}`)
      .set("Authorization", authHeader(tokenA))
      .send({ status: "IN_PROGRESS" })
      .expect(200);

    expect(res.body.status).toBe("IN_PROGRESS");
  });

  it("PATCH /issues/:key assigns the issue to A", async () => {
    const meRes = await request(app.getHttpServer())
      .get("/api/v1/auth/me")
      .set("Authorization", authHeader(tokenA))
      .expect(200);
    const userAId = meRes.body.id;

    const res = await request(app.getHttpServer())
      .patch(`/api/v1/issues/${issue2Key}`)
      .set("Authorization", authHeader(tokenA))
      .send({ assigneeId: userAId })
      .expect(200);

    expect(res.body.assigneeId).toBe(userAId);
  });

  it("GET /projects/:id/issues filters by status", async () => {
    const res = await request(app.getHttpServer())
      .get(`/api/v1/projects/${projectId}/issues?status=IN_PROGRESS`)
      .set("Authorization", authHeader(tokenA))
      .expect(200);

    expect(res.body.items).toHaveLength(1);
    expect(res.body.items[0].number).toBe(1);
  });

  it("GET /projects/:id/issues filters by assigneeId", async () => {
    const meRes = await request(app.getHttpServer())
      .get("/api/v1/auth/me")
      .set("Authorization", authHeader(tokenA))
      .expect(200);
    const userAId = meRes.body.id;

    const res = await request(app.getHttpServer())
      .get(`/api/v1/projects/${projectId}/issues?assigneeId=${userAId}`)
      .set("Authorization", authHeader(tokenA))
      .expect(200);

    expect(res.body.items).toHaveLength(1);
    expect(res.body.items[0].number).toBe(2);
  });

  it("A creates a label in the project", async () => {
    const res = await request(app.getHttpServer())
      .post(`/api/v1/projects/${projectId}/labels`)
      .set("Authorization", authHeader(tokenA))
      .send({ name: "bug", color: "#ff0000" })
      .expect(201);

    expect(res.body.name).toBe("bug");
    labelId = res.body.id;
  });

  it("creating a duplicate label name in the same project 409s", async () => {
    await request(app.getHttpServer())
      .post(`/api/v1/projects/${projectId}/labels`)
      .set("Authorization", authHeader(tokenA))
      .send({ name: "bug", color: "#00ff00" })
      .expect(409);
  });

  it("A attaches the label to an issue via PATCH labelIds", async () => {
    const res = await request(app.getHttpServer())
      .patch(`/api/v1/issues/${issue1Key}`)
      .set("Authorization", authHeader(tokenA))
      .send({ labelIds: [labelId] })
      .expect(200);

    expect(res.body.labelIds).toEqual([labelId]);
  });

  it("GET /projects/:id/issues filters by labelId", async () => {
    const res = await request(app.getHttpServer())
      .get(`/api/v1/projects/${projectId}/issues?labelId=${labelId}`)
      .set("Authorization", authHeader(tokenA))
      .expect(200);

    expect(res.body.items).toHaveLength(1);
    expect(res.body.items[0].number).toBe(1);
  });

  it("PATCH /issues/:key rejects an assigneeId outside the workspace", async () => {
    await request(app.getHttpServer())
      .patch(`/api/v1/issues/${issue1Key}`)
      .set("Authorization", authHeader(tokenA))
      .send({ assigneeId: "clxxxxxxxxxxxxxxxxxxxxxxx" })
      .expect(400);
  });

  it("B (non-member) gets 403 listing the project's issues", async () => {
    await request(app.getHttpServer())
      .get(`/api/v1/projects/${projectId}/issues`)
      .set("Authorization", authHeader(tokenB))
      .expect(403);
  });

  it("B (non-member) gets 403 reading an issue by key", async () => {
    await request(app.getHttpServer())
      .get(`/api/v1/issues/${issue1Key}`)
      .set("Authorization", authHeader(tokenB))
      .expect(403);
  });

  it("B (non-member) gets 403 creating an issue in the project", async () => {
    await request(app.getHttpServer())
      .post(`/api/v1/projects/${projectId}/issues`)
      .set("Authorization", authHeader(tokenB))
      .send({ title: "Sneaky issue" })
      .expect(403);
  });

  it("DELETE /issues/:key removes the second issue", async () => {
    await request(app.getHttpServer())
      .delete(`/api/v1/issues/${issue2Key}`)
      .set("Authorization", authHeader(tokenA))
      .expect(200);

    await request(app.getHttpServer())
      .get(`/api/v1/issues/${issue2Key}`)
      .set("Authorization", authHeader(tokenA))
      .expect(404);
  });

  it("DELETE /labels/:id removes the label", async () => {
    await request(app.getHttpServer())
      .delete(`/api/v1/labels/${labelId}`)
      .set("Authorization", authHeader(tokenA))
      .expect(200);

    const res = await request(app.getHttpServer())
      .get(`/api/v1/projects/${projectId}/labels`)
      .set("Authorization", authHeader(tokenA))
      .expect(200);
    expect(res.body).toHaveLength(0);
  });
});
