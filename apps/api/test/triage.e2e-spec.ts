import { INestApplication } from "@nestjs/common";
import { Test } from "@nestjs/testing";
import { Prisma } from "@prisma/client";
import cookieParser from "cookie-parser";
import request from "supertest";
import { AppModule } from "../src/app.module.js";
import { PrismaService } from "../src/prisma/prisma.service.js";

/**
 * End-to-end tests for Smart Triage (docs/design/nlq-search.md §2.7/§3.5)
 * against a REAL Postgres (docker :5434) + the applied `nlq_triage`
 * migration, incl. the real 60s-TTL Redis cache (docker :6380).
 *
 * Fixtures: workspace (A owner, B member) with one project and issues
 * covering each section for A — an overdue issue assigned to A, a stale
 * issue assigned to A (backdated via raw SQL since `updatedAt` is
 * `@updatedAt`-automatic), a mention thread (B mentions A, A hasn't replied)
 * plus a control thread where A DID reply (must NOT appear), and an
 * unassigned URGENT issue — plus a wholly separate FOREIGN workspace (owned
 * by C, NOT a member of A/B's workspace) used for the 403 regression suite
 * (mirrors test/issue-key-collision.e2e-spec.ts's/test/query-execute.e2e-spec.ts's
 * two-workspace pattern).
 *
 * Cache-busting note: `GET /triage` is cached 60s per (workspace, user); only
 * `POST /triage/dismiss` and `POST /triage/seen` invalidate it. Rather than
 * sleeping 60s in the suite, the escalation-undo assertion piggybacks on the
 * `POST /triage/seen` call it needs anyway (see that test's comment) to force
 * a fresh compute instead of returning a stale cached response.
 *
 * Cleans up everything it creates in afterAll (bottom-up: triageDismissal/
 * triageSeen -> comments -> issues -> projects -> members -> workspaces ->
 * users, FKs are RESTRICT) so the shared dev DB stays pristine (only `Demo
 * Workspace`).
 */
describe("Triage (e2e)", () => {
  let app: INestApplication;
  let prisma: PrismaService;

  const userAEmail = `e2e_triageA_${Date.now()}@example.com`;
  const userBEmail = `e2e_triageB_${Date.now()}@example.com`;
  const userCEmail = `e2e_triageC_${Date.now()}@example.com`;
  const password = "supersecret123";

  let tokenA: string;
  let tokenB: string;
  let tokenC: string;
  let userAId: string;

  let workspaceId: string;
  let projectId: string;
  let projectKey: string;

  let foreignWorkspaceId: string;
  let foreignProjectId: string;
  let foreignIssueId: string;

  let overdueIssueId: string;
  let overdueIssueKey: string;
  let staleIssueId: string;
  let needsReplyIssueId: string;
  let needsReplyIssueKey: string;
  let repliedIssueId: string;
  let repliedIssueKey: string;
  let unownedUrgentIssueId: string;
  let unownedUrgentIssueKey: string;

  const authHeader = (token: string) => `Bearer ${token}`;
  const DAY_MS = 24 * 60 * 60 * 1000;

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
      .send({ email: userAEmail, password, name: "Triage User A" })
      .expect(201);
    tokenA = regA.body.accessToken;
    userAId = regA.body.user.id;

    const regB = await request(app.getHttpServer())
      .post("/api/v1/auth/register")
      .send({ email: userBEmail, password, name: "Triage User B" })
      .expect(201);
    tokenB = regB.body.accessToken;

    const regC = await request(app.getHttpServer())
      .post("/api/v1/auth/register")
      .send({ email: userCEmail, password, name: "Triage User C" })
      .expect(201);
    tokenC = regC.body.accessToken;

    const ws = await request(app.getHttpServer())
      .post("/api/v1/workspaces")
      .set("Authorization", authHeader(tokenA))
      .send({ name: `Triage E2E Workspace ${Date.now()}` })
      .expect(201);
    workspaceId = ws.body.id;

    await request(app.getHttpServer())
      .post(`/api/v1/workspaces/${workspaceId}/members`)
      .set("Authorization", authHeader(tokenA))
      .send({ email: userBEmail })
      .expect(201);

    projectKey = `TRG${Date.now().toString().slice(-6)}`;
    const proj = await request(app.getHttpServer())
      .post("/api/v1/projects")
      .set("Authorization", authHeader(tokenA))
      .send({ workspaceId, key: projectKey, name: "Triage E2E Project" })
      .expect(201);
    projectId = proj.body.id;

    // OVERDUE: assigned to A, due yesterday, not DONE.
    const overdue = await request(app.getHttpServer())
      .post(`/api/v1/projects/${projectId}/issues`)
      .set("Authorization", authHeader(tokenA))
      .send({
        title: "Renew the TLS cert",
        priority: "MEDIUM",
        assigneeId: userAId,
        dueDate: new Date(Date.now() - DAY_MS).toISOString(),
      })
      .expect(201);
    overdueIssueId = overdue.body.id;
    overdueIssueKey = `${projectKey}-${overdue.body.number}`;

    // GOING_STALE: assigned to A, not DONE, backdated updatedAt (>7d) via raw SQL (updatedAt is @updatedAt-automatic).
    const stale = await request(app.getHttpServer())
      .post(`/api/v1/projects/${projectId}/issues`)
      .set("Authorization", authHeader(tokenA))
      .send({ title: "Investigate flaky test", priority: "MEDIUM", assigneeId: userAId })
      .expect(201);
    staleIssueId = stale.body.id;
    await prisma.$executeRaw(
      Prisma.sql`UPDATE "Issue" SET "updatedAt" = ${new Date(Date.now() - 10 * DAY_MS)} WHERE id = ${staleIssueId}`,
    );

    // NEEDS_REPLY: B mentions A, A never replies.
    const needsReply = await request(app.getHttpServer())
      .post(`/api/v1/projects/${projectId}/issues`)
      .set("Authorization", authHeader(tokenA))
      .send({ title: "Design review needed" })
      .expect(201);
    needsReplyIssueId = needsReply.body.id;
    needsReplyIssueKey = `${projectKey}-${needsReply.body.number}`;
    await request(app.getHttpServer())
      .post(`/api/v1/issues/${needsReplyIssueKey}/comments`)
      .set("Authorization", authHeader(tokenB))
      .send({ body: "@A can you take a look?", mentionUserIds: [userAId] })
      .expect(201);

    // Control: B mentions A, but A DID reply afterward -> must NOT appear in NEEDS_REPLY.
    const replied = await request(app.getHttpServer())
      .post(`/api/v1/projects/${projectId}/issues`)
      .set("Authorization", authHeader(tokenA))
      .send({ title: "Already handled thread" })
      .expect(201);
    repliedIssueId = replied.body.id;
    repliedIssueKey = `${projectKey}-${replied.body.number}`;
    await request(app.getHttpServer())
      .post(`/api/v1/issues/${repliedIssueKey}/comments`)
      .set("Authorization", authHeader(tokenB))
      .send({ body: "@A ping", mentionUserIds: [userAId] })
      .expect(201);
    await request(app.getHttpServer())
      .post(`/api/v1/issues/${repliedIssueKey}/comments`)
      .set("Authorization", authHeader(tokenA))
      .send({ body: "On it, thanks!" })
      .expect(201);

    // UNOWNED_URGENT: unassigned, URGENT, not DONE.
    const unowned = await request(app.getHttpServer())
      .post(`/api/v1/projects/${projectId}/issues`)
      .set("Authorization", authHeader(tokenA))
      .send({ title: "Prod outage triage", priority: "URGENT" })
      .expect(201);
    unownedUrgentIssueId = unowned.body.id;
    unownedUrgentIssueKey = `${projectKey}-${unowned.body.number}`;

    // --- FOREIGN workspace (owner C only, A/B are NOT members) ---
    const foreignWs = await request(app.getHttpServer())
      .post("/api/v1/workspaces")
      .set("Authorization", authHeader(tokenC))
      .send({ name: `Triage E2E Foreign Workspace ${Date.now()}` })
      .expect(201);
    foreignWorkspaceId = foreignWs.body.id;

    const foreignKey = `TFX${Date.now().toString().slice(-6)}`;
    const foreignProj = await request(app.getHttpServer())
      .post("/api/v1/projects")
      .set("Authorization", authHeader(tokenC))
      .send({ workspaceId: foreignWorkspaceId, key: foreignKey, name: "Foreign Project" })
      .expect(201);
    foreignProjectId = foreignProj.body.id;

    const foreignIssue = await request(app.getHttpServer())
      .post(`/api/v1/projects/${foreignProjectId}/issues`)
      .set("Authorization", authHeader(tokenC))
      .send({ title: "Foreign issue", priority: "URGENT" })
      .expect(201);
    foreignIssueId = foreignIssue.body.id;
  });

  afterAll(async () => {
    if (prisma) {
      const workspaceIds = [workspaceId, foreignWorkspaceId].filter(Boolean);
      await prisma.triageDismissal.deleteMany({ where: { issue: { project: { workspaceId: { in: workspaceIds } } } } });
      await prisma.triageSeen.deleteMany({ where: { workspaceId: { in: workspaceIds } } });
      await prisma.comment.deleteMany({ where: { issue: { project: { workspaceId: { in: workspaceIds } } } } });
      await prisma.issue.deleteMany({ where: { project: { workspaceId: { in: workspaceIds } } } });
      await prisma.project.deleteMany({ where: { workspaceId: { in: workspaceIds } } });
      await prisma.workspaceMember.deleteMany({ where: { workspaceId: { in: workspaceIds } } });
      await prisma.workspace.deleteMany({ where: { id: { in: workspaceIds } } });
      await prisma.user.deleteMany({ where: { email: { in: [userAEmail, userBEmail, userCEmail] } } });

      const leftover = await prisma.workspace.findMany({ where: { name: { contains: "Triage E2E" } } });
      expect(leftover).toHaveLength(0);
    }
    if (app) await app.close();
  });

  it("GET /triage returns every section populated with the right issues, and badge = total rows on a fresh (no TriageSeen) visit", async () => {
    const res = await request(app.getHttpServer())
      .get(`/api/v1/triage?workspaceId=${workspaceId}`)
      .set("Authorization", authHeader(tokenA))
      .expect(200);

    const byKey = Object.fromEntries(res.body.sections.map((s: any) => [s.key, s]));

    expect(byKey.OVERDUE.items.map((i: any) => i.id)).toContain(overdueIssueId);
    expect(byKey.OVERDUE.ast).toEqual({ v: 1, assignee: "me", status: { not: "DONE" }, due: { overdue: true } });

    expect(byKey.GOING_STALE.items.map((i: any) => i.id)).toContain(staleIssueId);

    expect(byKey.NEEDS_REPLY.items.map((i: any) => i.id)).toContain(needsReplyIssueId);
    expect(byKey.NEEDS_REPLY.items.map((i: any) => i.id)).not.toContain(repliedIssueId);
    expect(byKey.NEEDS_REPLY.ast).toBeNull();

    expect(byKey.UNOWNED_URGENT.items.map((i: any) => i.id)).toContain(unownedUrgentIssueId);

    const totalRows = res.body.sections.flatMap((s: any) => s.items).length;
    expect(res.body.badge).toBe(totalRows);
    expect(res.body.badge).toBeGreaterThan(0);
  });

  it("POST /triage/dismiss removes the row from the next GET (cache-busted immediately, not after 60s)", async () => {
    await request(app.getHttpServer())
      .post("/api/v1/triage/dismiss")
      .set("Authorization", authHeader(tokenA))
      .send({ issueId: overdueIssueId, section: "OVERDUE" })
      .expect(200)
      .expect((res) => {
        expect(res.body).toEqual({ ok: true });
      });

    const res = await request(app.getHttpServer())
      .get(`/api/v1/triage?workspaceId=${workspaceId}`)
      .set("Authorization", authHeader(tokenA))
      .expect(200);

    const overdueSection = res.body.sections.find((s: any) => s.key === "OVERDUE");
    const overdueIds = (overdueSection?.items ?? []).map((i: any) => i.id);
    expect(overdueIds).not.toContain(overdueIssueId);
  });

  it("raising the dismissed issue's priority makes it reappear (escalation-undo), and POST /triage/seen then drops the badge to 0", async () => {
    await request(app.getHttpServer())
      .patch(`/api/v1/issues/${overdueIssueKey}`)
      .set("Authorization", authHeader(tokenA))
      .send({ priority: "URGENT" })
      .expect(200);

    // POST /triage/seen invalidates this user's 60s triage cache (same
    // mechanism `dismiss` uses) — reused here as the cache-bust so this
    // assertion doesn't need to sleep out a 60s TTL in the suite. It also
    // legitimately exercises the "badge drops to 0" behavior in the same call.
    await request(app.getHttpServer())
      .post("/api/v1/triage/seen")
      .set("Authorization", authHeader(tokenA))
      .send({ workspaceId })
      .expect(200)
      .expect((res) => {
        expect(res.body).toEqual({ ok: true });
      });

    const res = await request(app.getHttpServer())
      .get(`/api/v1/triage?workspaceId=${workspaceId}`)
      .set("Authorization", authHeader(tokenA))
      .expect(200);

    const overdueSection = res.body.sections.find((s: any) => s.key === "OVERDUE");
    expect(overdueSection).toBeDefined();
    expect(overdueSection.items.map((i: any) => i.id)).toContain(overdueIssueId);

    expect(res.body.badge).toBe(0);
  });

  it("assigning an UNOWNED_URGENT issue makes it disappear from the VERY NEXT GET /triage — no dismiss, no seen, no sleep (regression: the 60s cache used to only invalidate on dismiss/seen, so any other issue mutation left stale data — 'Assign to me' appeared to silently no-op)", async () => {
    const before = await request(app.getHttpServer())
      .get(`/api/v1/triage?workspaceId=${workspaceId}`)
      .set("Authorization", authHeader(tokenA))
      .expect(200);
    const unownedBefore = before.body.sections.find((s: any) => s.key === "UNOWNED_URGENT");
    expect(unownedBefore?.items.map((i: any) => i.id)).toContain(unownedUrgentIssueId);

    await request(app.getHttpServer())
      .patch(`/api/v1/issues/${unownedUrgentIssueKey}`)
      .set("Authorization", authHeader(tokenA))
      .send({ assigneeId: userAId })
      .expect(200)
      .expect((res) => {
        expect(res.body.assigneeId).toBe(userAId);
      });

    // No dismiss, no seen, no sleep — this GET must reflect the mutation
    // immediately via the issue.updated -> TriageCacheListener ->
    // delByWorkspace path, not the 60s TTL.
    const after = await request(app.getHttpServer())
      .get(`/api/v1/triage?workspaceId=${workspaceId}`)
      .set("Authorization", authHeader(tokenA))
      .expect(200);
    const unownedAfter = after.body.sections.find((s: any) => s.key === "UNOWNED_URGENT");
    expect((unownedAfter?.items ?? []).map((i: any) => i.id)).not.toContain(unownedUrgentIssueId);
  });

  it("a non-member gets 403 on GET /triage for a foreign workspace", async () => {
    await request(app.getHttpServer())
      .get(`/api/v1/triage?workspaceId=${foreignWorkspaceId}`)
      .set("Authorization", authHeader(tokenA))
      .expect(403);
  });

  it("dismissing an issue in a workspace you're not a member of is 403", async () => {
    await request(app.getHttpServer())
      .post("/api/v1/triage/dismiss")
      .set("Authorization", authHeader(tokenA))
      .send({ issueId: foreignIssueId, section: "UNOWNED_URGENT" })
      .expect(403);
  });
});
