import { INestApplication } from "@nestjs/common";
import { Test } from "@nestjs/testing";
import cookieParser from "cookie-parser";
import request from "supertest";
import { AppModule } from "../src/app.module.js";
import { PrismaService } from "../src/prisma/prisma.service.js";

/**
 * End-to-end board-rank move flow against a REAL Postgres (from
 * docker-compose, migrated). Mirrors test/issues.e2e-spec.ts's fixture style:
 *  - User A creates a workspace (OWNER) + project → 3 issues in TODO
 *    (ranks r1 < r2 < r3, since create() appends via rankBetween).
 *  - Move the 3rd issue to between the 1st and 2nd → list order becomes
 *    1, 3, 2.
 *  - Move an issue TODO -> IN_PROGRESS with no neighbors (end of column) →
 *    list reflects the new column + position.
 *  - User B (non-member) is 403'd moving an issue in the project.
 *  - Moving with a neighbor that belongs to a DIFFERENT project 400s.
 */
describe("Issues move (e2e)", () => {
  let app: INestApplication;
  let prisma: PrismaService;

  const userAEmail = `e2e_move_A_${Date.now()}@example.com`;
  const userBEmail = `e2e_move_B_${Date.now()}@example.com`;
  const password = "supersecret123";

  let tokenA: string;
  let tokenB: string;
  let workspaceId: string;
  let projectId: string;
  let projectKey: string;

  // A second, unrelated workspace+project (owned by B) to prove cross-project
  // neighbor rejection.
  let otherWorkspaceId: string;
  let otherProjectId: string;
  let otherIssueId: string;

  let issue1Key: string;
  let issue2Key: string;
  let issue3Key: string;
  let issue1Id: string;
  let issue2Id: string;
  let issue3Id: string;

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
      .send({ email: userAEmail, password, name: "Move User A" })
      .expect(201);
    tokenA = regA.body.accessToken;

    const regB = await request(app.getHttpServer())
      .post("/api/v1/auth/register")
      .send({ email: userBEmail, password, name: "Move User B" })
      .expect(201);
    tokenB = regB.body.accessToken;

    const ws = await request(app.getHttpServer())
      .post("/api/v1/workspaces")
      .set("Authorization", authHeader(tokenA))
      .send({ name: `Move E2E Workspace ${Date.now()}` })
      .expect(201);
    workspaceId = ws.body.id;

    projectKey = `MV${Date.now().toString().slice(-6)}`;
    const proj = await request(app.getHttpServer())
      .post("/api/v1/projects")
      .set("Authorization", authHeader(tokenA))
      .send({ workspaceId, key: projectKey, name: "Move E2E Project" })
      .expect(201);
    projectId = proj.body.id;

    // B's own workspace/project/issue, used only for the cross-project 400 case.
    const wsB = await request(app.getHttpServer())
      .post("/api/v1/workspaces")
      .set("Authorization", authHeader(tokenB))
      .send({ name: `Move E2E Other Workspace ${Date.now()}` })
      .expect(201);
    otherWorkspaceId = wsB.body.id;

    const otherProjectKey = `OT${Date.now().toString().slice(-6)}`;
    const otherProj = await request(app.getHttpServer())
      .post("/api/v1/projects")
      .set("Authorization", authHeader(tokenB))
      .send({ workspaceId: wsB.body.id, key: otherProjectKey, name: "Other Project" })
      .expect(201);
    otherProjectId = otherProj.body.id;

    const otherIssue = await request(app.getHttpServer())
      .post(`/api/v1/projects/${otherProjectId}/issues`)
      .set("Authorization", authHeader(tokenB))
      .send({ title: "Other project issue" })
      .expect(201);
    otherIssueId = otherIssue.body.id;
  });

  afterAll(async () => {
    if (prisma) {
      const workspaceIds = [workspaceId, otherWorkspaceId].filter(Boolean);
      await prisma.issue.deleteMany({ where: { project: { workspaceId: { in: workspaceIds } } } });
      await prisma.project.deleteMany({ where: { workspaceId: { in: workspaceIds } } });
      await prisma.workspaceMember.deleteMany({ where: { workspaceId: { in: workspaceIds } } });
      await prisma.workspace.deleteMany({ where: { id: { in: workspaceIds } } });
      await prisma.user.deleteMany({ where: { email: { in: [userAEmail, userBEmail] } } });
    }
    if (app) await app.close();
  });

  it("A creates 3 issues in TODO with strictly increasing ranks (r1 < r2 < r3)", async () => {
    const res1 = await request(app.getHttpServer())
      .post(`/api/v1/projects/${projectId}/issues`)
      .set("Authorization", authHeader(tokenA))
      .send({ title: "Issue One" })
      .expect(201);
    issue1Key = `${projectKey}-${res1.body.number}`;
    issue1Id = res1.body.id;

    const res2 = await request(app.getHttpServer())
      .post(`/api/v1/projects/${projectId}/issues`)
      .set("Authorization", authHeader(tokenA))
      .send({ title: "Issue Two" })
      .expect(201);
    issue2Key = `${projectKey}-${res2.body.number}`;
    issue2Id = res2.body.id;

    const res3 = await request(app.getHttpServer())
      .post(`/api/v1/projects/${projectId}/issues`)
      .set("Authorization", authHeader(tokenA))
      .send({ title: "Issue Three" })
      .expect(201);
    issue3Key = `${projectKey}-${res3.body.number}`;
    issue3Id = res3.body.id;

    expect(res1.body.rank < res2.body.rank).toBe(true);
    expect(res2.body.rank < res3.body.rank).toBe(true);
  });

  it("GET list initially reflects creation order 1, 2, 3", async () => {
    const res = await request(app.getHttpServer())
      .get(`/api/v1/projects/${projectId}/issues?status=TODO`)
      .set("Authorization", authHeader(tokenA))
      .expect(200);

    expect(res.body.items.map((i: any) => i.number)).toEqual([1, 2, 3]);
  });

  it("moves the 3rd issue between the 1st and 2nd -> list order becomes 1, 3, 2", async () => {
    const res = await request(app.getHttpServer())
      .post(`/api/v1/issues/${issue3Key}/move`)
      .set("Authorization", authHeader(tokenA))
      .send({ status: "TODO", afterIssueId: issue1Id, beforeIssueId: issue2Id })
      .expect(201);

    expect(res.body.status).toBe("TODO");

    const list = await request(app.getHttpServer())
      .get(`/api/v1/projects/${projectId}/issues?status=TODO`)
      .set("Authorization", authHeader(tokenA))
      .expect(200);

    expect(list.body.items.map((i: any) => i.number)).toEqual([1, 3, 2]);
  });

  it("moves an issue TODO -> IN_PROGRESS at the end of the column (no neighbors)", async () => {
    const res = await request(app.getHttpServer())
      .post(`/api/v1/issues/${issue1Key}/move`)
      .set("Authorization", authHeader(tokenA))
      .send({ status: "IN_PROGRESS" })
      .expect(201);

    expect(res.body.status).toBe("IN_PROGRESS");

    const todoList = await request(app.getHttpServer())
      .get(`/api/v1/projects/${projectId}/issues?status=TODO`)
      .set("Authorization", authHeader(tokenA))
      .expect(200);
    expect(todoList.body.items.map((i: any) => i.number)).toEqual([3, 2]);

    const inProgressList = await request(app.getHttpServer())
      .get(`/api/v1/projects/${projectId}/issues?status=IN_PROGRESS`)
      .set("Authorization", authHeader(tokenA))
      .expect(200);
    expect(inProgressList.body.items.map((i: any) => i.number)).toEqual([1]);
  });

  it("B (non-member) gets 403 moving an issue in A's project", async () => {
    await request(app.getHttpServer())
      .post(`/api/v1/issues/${issue2Key}/move`)
      .set("Authorization", authHeader(tokenB))
      .send({ status: "TODO" })
      .expect(403);
  });

  it("moving with a neighbor from a different project 400s", async () => {
    await request(app.getHttpServer())
      .post(`/api/v1/issues/${issue2Key}/move`)
      .set("Authorization", authHeader(tokenA))
      .send({ status: "TODO", afterIssueId: otherIssueId })
      .expect(400);
  });

  it("moving with a neighbor in the wrong status column 400s", async () => {
    await request(app.getHttpServer())
      .post(`/api/v1/issues/${issue2Key}/move`)
      .set("Authorization", authHeader(tokenA))
      .send({ status: "DONE", afterIssueId: issue3Id })
      .expect(400);
  });
});
