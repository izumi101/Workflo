import { INestApplication } from "@nestjs/common";
import { Test } from "@nestjs/testing";
import cookieParser from "cookie-parser";
import request from "supertest";
import { AppModule } from "../src/app.module.js";
import { PrismaService } from "../src/prisma/prisma.service.js";

/**
 * Regression test for the issue-key-workspace-scope bug: Project.key is only
 * unique WITHIN a workspace (@@unique([workspaceId, key])), but issue
 * human-keys ("WF-1") were being resolved GLOBALLY. When two workspaces each
 * have a project keyed the same, GET/PATCH/move/comments-by-key could
 * resolve the wrong workspace's issue for a caller who is only a member of
 * one of them — a false 403 (own issue misidentified as foreign) or, worse,
 * silently acting on a foreign workspace's issue.
 *
 * This spec creates TWO workspaces that BOTH have a project keyed "WF" with
 * an issue numbered 1 (so both resolve to the human key "WF-1"). userA is a
 * member of workspace1 only. Asserts every issue-key-resolving endpoint
 * (GET, PATCH, move, comments list/create) acts on workspace1's issue for
 * userA, never workspace2's, and that a key existing ONLY in workspace2 is
 * not-found/forbidden for userA (no foreign leak). Also re-confirms the
 * pre-existing non-member 403 behavior still holds.
 *
 * Cleans up everything it creates in afterAll (bottom-up, since FKs are
 * RESTRICT) so the shared dev DB isn't polluted.
 */
describe("Issue key collision across workspaces (e2e)", () => {
  let app: INestApplication;
  let prisma: PrismaService;

  const userAEmail = `e2e_collideA_${Date.now()}@example.com`;
  const userBEmail = `e2e_collideB_${Date.now()}@example.com`;
  const password = "supersecret123";

  let tokenA: string;
  let tokenB: string;

  // Workspace 1: userA is OWNER (and the only member).
  let workspace1Id: string;
  let project1Id: string;
  // Workspace 2: userB is OWNER; userA is NOT a member.
  let workspace2Id: string;
  let project2Id: string;
  // Workspace 3: userB is OWNER; has a project keyed "WF" but userA is not a
  // member here either — used for the "key exists only in a foreign
  // workspace" case with a SECOND issue number so it doesn't collide with
  // workspace2's WF-1 in the same describe block's assertions.
  let workspace3Id: string;
  let project3Id: string;

  const SHARED_KEY = "WF"; // deliberately identical project key across workspaces

  let issue1Title: string;
  let issue2Title: string;

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
      .send({ email: userAEmail, password, name: "Collide User A" })
      .expect(201);
    tokenA = regA.body.accessToken;

    const regB = await request(app.getHttpServer())
      .post("/api/v1/auth/register")
      .send({ email: userBEmail, password, name: "Collide User B" })
      .expect(201);
    tokenB = regB.body.accessToken;

    // Workspace 1 (userA's own).
    const ws1 = await request(app.getHttpServer())
      .post("/api/v1/workspaces")
      .set("Authorization", authHeader(tokenA))
      .send({ name: `Collide WS1 ${Date.now()}` })
      .expect(201);
    workspace1Id = ws1.body.id;

    const proj1 = await request(app.getHttpServer())
      .post("/api/v1/projects")
      .set("Authorization", authHeader(tokenA))
      .send({ workspaceId: workspace1Id, key: SHARED_KEY, name: "WS1 Project" })
      .expect(201);
    project1Id = proj1.body.id;

    issue1Title = `WS1 issue ${Date.now()}`;
    await request(app.getHttpServer())
      .post(`/api/v1/projects/${project1Id}/issues`)
      .set("Authorization", authHeader(tokenA))
      .send({ title: issue1Title })
      .expect(201);

    // Workspace 2 (userB's own, userA NOT a member) — same project key "WF".
    const ws2 = await request(app.getHttpServer())
      .post("/api/v1/workspaces")
      .set("Authorization", authHeader(tokenB))
      .send({ name: `Collide WS2 ${Date.now()}` })
      .expect(201);
    workspace2Id = ws2.body.id;

    const proj2 = await request(app.getHttpServer())
      .post("/api/v1/projects")
      .set("Authorization", authHeader(tokenB))
      .send({ workspaceId: workspace2Id, key: SHARED_KEY, name: "WS2 Project" })
      .expect(201);
    project2Id = proj2.body.id;

    issue2Title = `WS2 issue ${Date.now()}`;
    await request(app.getHttpServer())
      .post(`/api/v1/projects/${project2Id}/issues`)
      .set("Authorization", authHeader(tokenB))
      .send({ title: issue2Title })
      .expect(201);

    // Workspace 3 (userB's own, userA NOT a member) — also key "WF", used
    // purely for the "exists only in a foreign workspace" 403/404 check on a
    // key that does NOT exist in workspace1 or workspace2 at all (WF-2).
    const ws3 = await request(app.getHttpServer())
      .post("/api/v1/workspaces")
      .set("Authorization", authHeader(tokenB))
      .send({ name: `Collide WS3 ${Date.now()}` })
      .expect(201);
    workspace3Id = ws3.body.id;

    const proj3 = await request(app.getHttpServer())
      .post("/api/v1/projects")
      .set("Authorization", authHeader(tokenB))
      .send({ workspaceId: workspace3Id, key: SHARED_KEY, name: "WS3 Project" })
      .expect(201);
    project3Id = proj3.body.id;

    // Two issues in WS3 so its second issue (WF-2) exists ONLY in WS3, not
    // in WS1 or WS2.
    await request(app.getHttpServer())
      .post(`/api/v1/projects/${project3Id}/issues`)
      .set("Authorization", authHeader(tokenB))
      .send({ title: "WS3 filler issue" })
      .expect(201);
    await request(app.getHttpServer())
      .post(`/api/v1/projects/${project3Id}/issues`)
      .set("Authorization", authHeader(tokenB))
      .send({ title: "WS3 only issue (WF-2)" })
      .expect(201);
  });

  afterAll(async () => {
    if (prisma) {
      const workspaceIds = [workspace1Id, workspace2Id, workspace3Id].filter(Boolean);
      await prisma.comment.deleteMany({ where: { issue: { project: { workspaceId: { in: workspaceIds } } } } });
      await prisma.issue.deleteMany({ where: { project: { workspaceId: { in: workspaceIds } } } });
      await prisma.label.deleteMany({ where: { project: { workspaceId: { in: workspaceIds } } } });
      await prisma.project.deleteMany({ where: { workspaceId: { in: workspaceIds } } });
      await prisma.workspaceMember.deleteMany({ where: { workspaceId: { in: workspaceIds } } });
      await prisma.workspace.deleteMany({ where: { id: { in: workspaceIds } } });
      await prisma.user.deleteMany({ where: { email: { in: [userAEmail, userBEmail] } } });
    }
    if (app) await app.close();
  });

  it("GET /issues/WF-1 as userA returns workspace1's issue, not workspace2's, and not a 403", async () => {
    const res = await request(app.getHttpServer())
      .get(`/api/v1/issues/${SHARED_KEY}-1`)
      .set("Authorization", authHeader(tokenA))
      .expect(200);

    expect(res.body.title).toBe(issue1Title);
    expect(res.body.projectId).toBe(project1Id);
  });

  it("GET /issues/WF-1 as userB returns workspace2's issue (proves both sides resolve their own)", async () => {
    const res = await request(app.getHttpServer())
      .get(`/api/v1/issues/${SHARED_KEY}-1`)
      .set("Authorization", authHeader(tokenB))
      .expect(200);

    expect(res.body.title).toBe(issue2Title);
    expect(res.body.projectId).toBe(project2Id);
  });

  it("PATCH /issues/WF-1 as userA updates workspace1's issue only", async () => {
    const res = await request(app.getHttpServer())
      .patch(`/api/v1/issues/${SHARED_KEY}-1`)
      .set("Authorization", authHeader(tokenA))
      .send({ priority: "HIGH" })
      .expect(200);

    expect(res.body.projectId).toBe(project1Id);
    expect(res.body.priority).toBe("HIGH");

    // workspace2's WF-1 must be untouched.
    const wsB = await request(app.getHttpServer())
      .get(`/api/v1/issues/${SHARED_KEY}-1`)
      .set("Authorization", authHeader(tokenB))
      .expect(200);
    expect(wsB.body.priority).not.toBe("HIGH");
  });

  it("POST /issues/WF-1/move as userA moves workspace1's issue only", async () => {
    const res = await request(app.getHttpServer())
      .post(`/api/v1/issues/${SHARED_KEY}-1/move`)
      .set("Authorization", authHeader(tokenA))
      .send({ status: "IN_PROGRESS" })
      .expect(201);

    expect(res.body.projectId).toBe(project1Id);
    expect(res.body.status).toBe("IN_PROGRESS");

    // workspace2's WF-1 must remain TODO.
    const wsB = await request(app.getHttpServer())
      .get(`/api/v1/issues/${SHARED_KEY}-1`)
      .set("Authorization", authHeader(tokenB))
      .expect(200);
    expect(wsB.body.status).toBe("TODO");
  });

  it("GET/POST /issues/WF-1/comments as userA act on workspace1's issue only", async () => {
    const commentBody = `Collision comment ${Date.now()}`;
    const createRes = await request(app.getHttpServer())
      .post(`/api/v1/issues/${SHARED_KEY}-1/comments`)
      .set("Authorization", authHeader(tokenA))
      .send({ body: commentBody })
      .expect(201);
    expect(createRes.body.body).toBe(commentBody);

    const listRes = await request(app.getHttpServer())
      .get(`/api/v1/issues/${SHARED_KEY}-1/comments`)
      .set("Authorization", authHeader(tokenA))
      .expect(200);
    expect(listRes.body.items.map((c: any) => c.body)).toContain(commentBody);

    // Confirm this comment attached to workspace1's issue, not workspace2's:
    // userB's WF-1 comment list must NOT contain it.
    const listAsB = await request(app.getHttpServer())
      .get(`/api/v1/issues/${SHARED_KEY}-1/comments`)
      .set("Authorization", authHeader(tokenB))
      .expect(200);
    expect(listAsB.body.items.map((c: any) => c.body)).not.toContain(commentBody);
  });

  it("a key existing ONLY in a foreign workspace (WF-2, only in workspace3) is not-found/forbidden for userA — no leak", async () => {
    const res = await request(app.getHttpServer())
      .get(`/api/v1/issues/${SHARED_KEY}-2`)
      .set("Authorization", authHeader(tokenA))
      .send();

    expect([403, 404]).toContain(res.status);
  });

  it("existing non-member 403 behavior still holds for a wholly foreign workspace's issue", async () => {
    // userA is not a member of workspace3 at all; WF-2 only exists there.
    await request(app.getHttpServer())
      .patch(`/api/v1/issues/${SHARED_KEY}-2`)
      .set("Authorization", authHeader(tokenA))
      .send({ priority: "LOW" })
      .expect((res) => {
        if (![403, 404].includes(res.status)) {
          throw new Error(`Expected 403 or 404, got ${res.status}`);
        }
      });
  });
});
