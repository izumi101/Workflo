import { INestApplication } from "@nestjs/common";
import { Test } from "@nestjs/testing";
import cookieParser from "cookie-parser";
import request from "supertest";
import { AppModule } from "../src/app.module.js";
import { PrismaService } from "../src/prisma/prisma.service.js";

/**
 * End-to-end tests for Saved Views (docs/design/nlq-search.md §2.6/§3.5)
 * against a REAL Postgres (docker :5434), incl. the applied `nlq_views`
 * migration.
 *
 * Fixtures: workspace (A owner, B member) plus a wholly separate FOREIGN
 * workspace owned by C (NOT a member of A/B's workspace) — mirrors
 * test/issue-key-collision.e2e-spec.ts's/test/query-execute.e2e-spec.ts's
 * two-workspace pattern for the non-member 403 case.
 *
 * Cleans up everything it creates in afterAll (bottom-up: views -> members
 * -> workspaces -> users, FKs are RESTRICT) so the shared dev DB stays
 * pristine (only `Demo Workspace`).
 */
describe("Views (e2e)", () => {
  let app: INestApplication;
  let prisma: PrismaService;

  const userAEmail = `e2e_viewsA_${Date.now()}@example.com`;
  const userBEmail = `e2e_viewsB_${Date.now()}@example.com`;
  const userCEmail = `e2e_viewsC_${Date.now()}@example.com`;
  const password = "supersecret123";

  let tokenA: string;
  let tokenB: string;
  let tokenC: string;
  let userAId: string;
  let userBId: string;

  let workspaceId: string;
  let foreignWorkspaceId: string;

  let personalViewId: string;
  let workspaceViewId: string;

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
      .send({ email: userAEmail, password, name: "Views User A" })
      .expect(201);
    tokenA = regA.body.accessToken;
    userAId = regA.body.user.id;

    const regB = await request(app.getHttpServer())
      .post("/api/v1/auth/register")
      .send({ email: userBEmail, password, name: "Views User B" })
      .expect(201);
    tokenB = regB.body.accessToken;
    userBId = regB.body.user.id;

    const regC = await request(app.getHttpServer())
      .post("/api/v1/auth/register")
      .send({ email: userCEmail, password, name: "Views User C" })
      .expect(201);
    tokenC = regC.body.accessToken;

    const ws = await request(app.getHttpServer())
      .post("/api/v1/workspaces")
      .set("Authorization", authHeader(tokenA))
      .send({ name: `Views E2E Workspace ${Date.now()}` })
      .expect(201);
    workspaceId = ws.body.id;

    await request(app.getHttpServer())
      .post(`/api/v1/workspaces/${workspaceId}/members`)
      .set("Authorization", authHeader(tokenA))
      .send({ email: userBEmail })
      .expect(201);

    // A wholly foreign workspace (C is its owner, NOT a member of `workspaceId`).
    const foreignWs = await request(app.getHttpServer())
      .post("/api/v1/workspaces")
      .set("Authorization", authHeader(tokenC))
      .send({ name: `Views E2E Foreign Workspace ${Date.now()}` })
      .expect(201);
    foreignWorkspaceId = foreignWs.body.id;
  });

  afterAll(async () => {
    if (prisma && workspaceId) {
      await prisma.view.deleteMany({ where: { workspaceId } });
      await prisma.workspaceMember.deleteMany({ where: { workspaceId } });
      await prisma.workspace.deleteMany({ where: { id: workspaceId } });
    }
    if (prisma && foreignWorkspaceId) {
      await prisma.view.deleteMany({ where: { workspaceId: foreignWorkspaceId } });
      await prisma.workspaceMember.deleteMany({ where: { workspaceId: foreignWorkspaceId } });
      await prisma.workspace.deleteMany({ where: { id: foreignWorkspaceId } });
    }
    if (prisma) {
      await prisma.user.deleteMany({ where: { email: { in: [userAEmail, userBEmail, userCEmail] } } });

      const leftover = await prisma.workspace.findMany({
        where: { name: { contains: "Views E2E" } },
      });
      expect(leftover).toHaveLength(0);
    }

    if (app) await app.close();
  });

  it("B's first GET /views returns exactly the 3 seeded defaults", async () => {
    const res = await request(app.getHttpServer())
      .get(`/api/v1/views?workspaceId=${workspaceId}`)
      .set("Authorization", authHeader(tokenB))
      .expect(200);

    expect(res.body).toHaveLength(3);
    const byName = Object.fromEntries(res.body.map((v: any) => [v.name, v]));
    expect(Object.keys(byName).sort()).toEqual(["Assigned to me", "Due this week", "Reported by me"]);
    expect(byName["Assigned to me"].ast).toEqual({ v: 1, assignee: "me" });
    expect(byName["Reported by me"].ast).toEqual({ v: 1, reporter: "me" });
    expect(byName["Due this week"].ast).toEqual({ v: 1, due: { withinDays: 7 } });
    expect(
      res.body.every(
        (v: any) => v.scope === "PERSONAL" && v.creatorId === userBId && v.workspaceId === workspaceId && v.pinned === false,
      ),
    ).toBe(true);
  });

  it("a second GET does NOT re-seed — still 3, not 6", async () => {
    const res = await request(app.getHttpServer())
      .get(`/api/v1/views?workspaceId=${workspaceId}`)
      .set("Authorization", authHeader(tokenB))
      .expect(200);

    expect(res.body).toHaveLength(3);
  });

  it("A creates a PERSONAL view (absent from B's list) and a WORKSPACE view (present in B's list)", async () => {
    const personalRes = await request(app.getHttpServer())
      .post("/api/v1/views")
      .set("Authorization", authHeader(tokenA))
      .send({ workspaceId, name: "A's private view", ast: { v: 1, text: "secret" }, scope: "PERSONAL" })
      .expect(201);
    personalViewId = personalRes.body.id;
    expect(personalRes.body.creatorId).toBe(userAId);
    expect(personalRes.body.scope).toBe("PERSONAL");

    const workspaceRes = await request(app.getHttpServer())
      .post("/api/v1/views")
      .set("Authorization", authHeader(tokenA))
      .send({ workspaceId, name: "Team view", ast: { v: 1, status: { not: "DONE" } }, scope: "WORKSPACE" })
      .expect(201);
    workspaceViewId = workspaceRes.body.id;

    const bList = await request(app.getHttpServer())
      .get(`/api/v1/views?workspaceId=${workspaceId}`)
      .set("Authorization", authHeader(tokenB))
      .expect(200);
    const bIds = bList.body.map((v: any) => v.id);
    expect(bIds).not.toContain(personalViewId);
    expect(bIds).toContain(workspaceViewId);
  });

  it("B (member, non-creator) gets 403 on PATCH/DELETE of A's WORKSPACE view", async () => {
    await request(app.getHttpServer())
      .patch(`/api/v1/views/${workspaceViewId}`)
      .set("Authorization", authHeader(tokenB))
      .send({ pinned: true })
      .expect(403);

    await request(app.getHttpServer())
      .delete(`/api/v1/views/${workspaceViewId}`)
      .set("Authorization", authHeader(tokenB))
      .expect(403);
  });

  it("A (owner) can PATCH and DELETE B's WORKSPACE view even though A isn't its creator", async () => {
    const bWorkspaceViewRes = await request(app.getHttpServer())
      .post("/api/v1/views")
      .set("Authorization", authHeader(tokenB))
      .send({ workspaceId, name: "B's team view", ast: { v: 1, priority: { atLeast: "HIGH" } }, scope: "WORKSPACE" })
      .expect(201);
    const bWorkspaceViewId = bWorkspaceViewRes.body.id;

    const patchRes = await request(app.getHttpServer())
      .patch(`/api/v1/views/${bWorkspaceViewId}`)
      .set("Authorization", authHeader(tokenA))
      .send({ name: "Renamed by owner" })
      .expect(200);
    expect(patchRes.body.name).toBe("Renamed by owner");

    await request(app.getHttpServer())
      .delete(`/api/v1/views/${bWorkspaceViewId}`)
      .set("Authorization", authHeader(tokenA))
      .expect(200);

    const found = await prisma.view.findUnique({ where: { id: bWorkspaceViewId } });
    expect(found).toBeNull();
  });

  it("creator can edit their own PERSONAL view (pin toggle), and it moves to the top of the ordering", async () => {
    const patchRes = await request(app.getHttpServer())
      .patch(`/api/v1/views/${personalViewId}`)
      .set("Authorization", authHeader(tokenA))
      .send({ pinned: true })
      .expect(200);
    expect(patchRes.body.pinned).toBe(true);

    const listRes = await request(app.getHttpServer())
      .get(`/api/v1/views?workspaceId=${workspaceId}`)
      .set("Authorization", authHeader(tokenA))
      .expect(200);
    expect(listRes.body[0].id).toBe(personalViewId);
    expect(listRes.body[0].pinned).toBe(true);
  });

  it("a non-member (third user, owner of a wholly separate workspace) gets 403 on GET /views for A's workspace", async () => {
    await request(app.getHttpServer())
      .get(`/api/v1/views?workspaceId=${workspaceId}`)
      .set("Authorization", authHeader(tokenC))
      .expect(403);
  });

  it("PATCH on a nonexistent view id returns 404", async () => {
    await request(app.getHttpServer())
      .patch("/api/v1/views/clxxxxxxxxxxxxxxxxxxxxxxx")
      .set("Authorization", authHeader(tokenA))
      .send({ name: "ghost" })
      .expect(404);
  });
});
