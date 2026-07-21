import { INestApplication } from "@nestjs/common";
import { Test } from "@nestjs/testing";
import cookieParser from "cookie-parser";
import request from "supertest";
import { AppModule } from "../src/app.module.js";
import { PrismaService } from "../src/prisma/prisma.service.js";

/**
 * End-to-end tests for the NLQ query engine's `POST /api/v1/query/execute`
 * (docs/design/nlq-search.md §3.1/§3.2), against a REAL Postgres (docker
 * :5434) + the applied `nlq_indexes` migration.
 *
 * Fixtures: workspace1 (A owner, B member) with two projects (P1, P2) and
 * five issues chosen to exercise project/type/status/priority/assignee/
 * labels/due/text filters, plus a wholly separate FOREIGN workspace (owned
 * by C, who is NOT a member of workspace1) with its own project/issue/
 * label — used exclusively for the security-regression suite (mirrors
 * test/issue-key-collision.e2e-spec.ts's two-workspace pattern).
 *
 * Cleans up everything it creates in afterAll (bottom-up, FKs are
 * RESTRICT) so the shared dev DB stays pristine (only `Demo Workspace`).
 */
describe("POST /query/execute — NLQ query engine (e2e)", () => {
  let app: INestApplication;
  let prisma: PrismaService;

  const userAEmail = `e2e_queryA_${Date.now()}@example.com`;
  const userBEmail = `e2e_queryB_${Date.now()}@example.com`;
  const userCEmail = `e2e_queryC_${Date.now()}@example.com`;
  const userDEmail = `e2e_queryD_${Date.now()}@example.com`;
  const password = "supersecret123";

  let tokenA: string;
  let tokenB: string;
  let tokenC: string;
  let tokenD: string;
  let userAId: string;
  let userBId: string;
  let userCId: string;

  let workspaceId: string;
  let project1Id: string;
  let project2Id: string;
  let label1Id: string;
  let label2Id: string;

  let issue1Id: string; // P1: BUG, URGENT, TODO, assignee=A, due=tomorrow, label1
  let issue2Id: string; // P1: TASK, LOW, DONE, assignee=B, due=null
  let issue3Id: string; // P2: TASK, HIGH, IN_PROGRESS, unassigned, due=+20d, label2
  let issue4Id: string; // P2: TASK, MEDIUM, TODO, assignee=A, reporter=B, due=null
  let issue5Id: string; // P1: TASK, MEDIUM, TODO, unassigned, due=yesterday (overdue)

  let foreignWorkspaceId: string;
  let foreignProjectId: string;
  let foreignLabelId: string;
  let foreignIssueTitle: string;

  const authHeader = (token: string) => `Bearer ${token}`;
  const DAY_MS = 24 * 60 * 60 * 1000;
  const yesterday = new Date(Date.now() - DAY_MS).toISOString();
  const tomorrow = new Date(Date.now() + DAY_MS).toISOString();
  const farFuture = new Date(Date.now() + 20 * DAY_MS).toISOString();

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
      .send({ email: userAEmail, password, name: "Query User A" })
      .expect(201);
    tokenA = regA.body.accessToken;
    userAId = regA.body.user.id;

    const regB = await request(app.getHttpServer())
      .post("/api/v1/auth/register")
      .send({ email: userBEmail, password, name: "Query User B" })
      .expect(201);
    tokenB = regB.body.accessToken;
    userBId = regB.body.user.id;

    const regC = await request(app.getHttpServer())
      .post("/api/v1/auth/register")
      .send({ email: userCEmail, password, name: "Query User C" })
      .expect(201);
    tokenC = regC.body.accessToken;
    userCId = regC.body.user.id;

    const regD = await request(app.getHttpServer())
      .post("/api/v1/auth/register")
      .send({ email: userDEmail, password, name: "Query User D" })
      .expect(201);
    tokenD = regD.body.accessToken;

    // --- workspace1: A (owner) + B (member) ---
    const ws = await request(app.getHttpServer())
      .post("/api/v1/workspaces")
      .set("Authorization", authHeader(tokenA))
      .send({ name: `Query E2E Workspace ${Date.now()}` })
      .expect(201);
    workspaceId = ws.body.id;

    await request(app.getHttpServer())
      .post(`/api/v1/workspaces/${workspaceId}/members`)
      .set("Authorization", authHeader(tokenA))
      .send({ email: userBEmail })
      .expect(201);

    const key1 = `Q1${Date.now().toString().slice(-6)}`;
    const proj1 = await request(app.getHttpServer())
      .post("/api/v1/projects")
      .set("Authorization", authHeader(tokenA))
      .send({ workspaceId, key: key1, name: "Query E2E Project 1" })
      .expect(201);
    project1Id = proj1.body.id;

    const key2 = `Q2${Date.now().toString().slice(-6)}`;
    const proj2 = await request(app.getHttpServer())
      .post("/api/v1/projects")
      .set("Authorization", authHeader(tokenA))
      .send({ workspaceId, key: key2, name: "Query E2E Project 2" })
      .expect(201);
    project2Id = proj2.body.id;

    const l1 = await request(app.getHttpServer())
      .post(`/api/v1/projects/${project1Id}/labels`)
      .set("Authorization", authHeader(tokenA))
      .send({ name: "frontend", color: "#ff0000" })
      .expect(201);
    label1Id = l1.body.id;

    const l2 = await request(app.getHttpServer())
      .post(`/api/v1/projects/${project2Id}/labels`)
      .set("Authorization", authHeader(tokenA))
      .send({ name: "backend", color: "#00ff00" })
      .expect(201);
    label2Id = l2.body.id;

    // issue1 (P1): BUG, URGENT, assignee=A, due=tomorrow, label1
    const i1 = await request(app.getHttpServer())
      .post(`/api/v1/projects/${project1Id}/issues`)
      .set("Authorization", authHeader(tokenA))
      .send({
        title: "Fix the login bug",
        description: "Users can't log in on Safari. Needed for the release.",
        type: "BUG",
        priority: "URGENT",
        assigneeId: userAId,
        dueDate: tomorrow,
        labelIds: [label1Id],
      })
      .expect(201);
    issue1Id = i1.body.id;

    // issue2 (P1): TASK, LOW, assignee=B, later moved to DONE.
    const i2 = await request(app.getHttpServer())
      .post(`/api/v1/projects/${project1Id}/issues`)
      .set("Authorization", authHeader(tokenA))
      .send({ title: "Write onboarding docs", priority: "LOW", assigneeId: userBId })
      .expect(201);
    issue2Id = i2.body.id;
    await request(app.getHttpServer())
      .patch(`/api/v1/issues/${key1}-${i2.body.number}`)
      .set("Authorization", authHeader(tokenA))
      .send({ status: "DONE" })
      .expect(200);

    // issue3 (P2): TASK, HIGH, unassigned, due=+20d, label2. Moved to IN_PROGRESS.
    const i3 = await request(app.getHttpServer())
      .post(`/api/v1/projects/${project2Id}/issues`)
      .set("Authorization", authHeader(tokenA))
      .send({
        title: "Investigate slow test run",
        description: "CI run takes 20 minutes. Needed for the release.",
        priority: "HIGH",
        dueDate: farFuture,
        labelIds: [label2Id],
      })
      .expect(201);
    issue3Id = i3.body.id;
    await request(app.getHttpServer())
      .patch(`/api/v1/issues/${key2}-${i3.body.number}`)
      .set("Authorization", authHeader(tokenA))
      .send({ status: "IN_PROGRESS" })
      .expect(200);

    // issue4 (P2): TASK, MEDIUM, assignee=A, reporter=B (created by B).
    const i4 = await request(app.getHttpServer())
      .post(`/api/v1/projects/${project2Id}/issues`)
      .set("Authorization", authHeader(tokenB))
      .send({
        title: "Add dark mode toggle",
        description: "Design requested a theme switch. Needed for the release.",
        priority: "MEDIUM",
        assigneeId: userAId,
      })
      .expect(201);
    issue4Id = i4.body.id;

    // issue5 (P1): TASK, MEDIUM, unassigned, due=yesterday (overdue, status stays TODO).
    const i5 = await request(app.getHttpServer())
      .post(`/api/v1/projects/${project1Id}/issues`)
      .set("Authorization", authHeader(tokenA))
      .send({ title: "Renew SSL cert", priority: "MEDIUM", dueDate: yesterday })
      .expect(201);
    issue5Id = i5.body.id;

    // --- FOREIGN workspace (owner C only, A/B/D are NOT members) ---
    const foreignWs = await request(app.getHttpServer())
      .post("/api/v1/workspaces")
      .set("Authorization", authHeader(tokenC))
      .send({ name: `Query E2E Foreign Workspace ${Date.now()}` })
      .expect(201);
    foreignWorkspaceId = foreignWs.body.id;

    const foreignKey = `FX${Date.now().toString().slice(-6)}`;
    const foreignProj = await request(app.getHttpServer())
      .post("/api/v1/projects")
      .set("Authorization", authHeader(tokenC))
      .send({ workspaceId: foreignWorkspaceId, key: foreignKey, name: "Foreign Project" })
      .expect(201);
    foreignProjectId = foreignProj.body.id;

    const foreignLabel = await request(app.getHttpServer())
      .post(`/api/v1/projects/${foreignProjectId}/labels`)
      .set("Authorization", authHeader(tokenC))
      .send({ name: "foreign-label", color: "#0000ff" })
      .expect(201);
    foreignLabelId = foreignLabel.body.id;

    foreignIssueTitle = "Foreign secret issue — must never leak";
    await request(app.getHttpServer())
      .post(`/api/v1/projects/${foreignProjectId}/issues`)
      .set("Authorization", authHeader(tokenC))
      .send({ title: foreignIssueTitle, priority: "URGENT", type: "BUG" })
      .expect(201);
  });

  afterAll(async () => {
    if (prisma) {
      const workspaceIds = [workspaceId, foreignWorkspaceId].filter(Boolean);
      await prisma.comment.deleteMany({ where: { issue: { project: { workspaceId: { in: workspaceIds } } } } });
      await prisma.issue.deleteMany({ where: { project: { workspaceId: { in: workspaceIds } } } });
      await prisma.label.deleteMany({ where: { project: { workspaceId: { in: workspaceIds } } } });
      await prisma.project.deleteMany({ where: { workspaceId: { in: workspaceIds } } });
      await prisma.workspaceMember.deleteMany({ where: { workspaceId: { in: workspaceIds } } });
      await prisma.workspace.deleteMany({ where: { id: { in: workspaceIds } } });
      await prisma.user.deleteMany({ where: { email: { in: [userAEmail, userBEmail, userCEmail, userDEmail] } } });
    }
    if (app) await app.close();
  });

  const execute = (token: string, ast: unknown, extra: Record<string, unknown> = {}) =>
    request(app.getHttpServer())
      .post("/api/v1/query/execute")
      .set("Authorization", authHeader(token))
      .send({ workspaceId, ast, ...extra });

  describe("basic clause filters", () => {
    it("project.in scopes to one project only", async () => {
      const res = await execute(tokenA, { v: 1, project: { in: [project1Id] } }).expect(200);
      const ids = res.body.items.map((i: any) => i.id);
      expect(ids.sort()).toEqual([issue1Id, issue2Id, issue5Id].sort());
    });

    it("type.in matches BUG only", async () => {
      const res = await execute(tokenA, { v: 1, type: { in: ["BUG"] } }).expect(200);
      expect(res.body.items).toHaveLength(1);
      expect(res.body.items[0].id).toBe(issue1Id);
      expect(res.body.items[0].type).toBe("BUG");
    });

    it('assignee: "me" (as user A) returns issue1 and issue4', async () => {
      const res = await execute(tokenA, { v: 1, assignee: "me" }).expect(200);
      const ids = res.body.items.map((i: any) => i.id);
      expect(ids.sort()).toEqual([issue1Id, issue4Id].sort());
      expect(res.body.items.every((i: any) => i.assigneeId === userAId)).toBe(true);
    });

    it('assignee: "unassigned" returns issue3 and issue5', async () => {
      const res = await execute(tokenA, { v: 1, assignee: "unassigned" }).expect(200);
      const ids = res.body.items.map((i: any) => i.id);
      expect(ids.sort()).toEqual([issue3Id, issue5Id].sort());
      expect(res.body.items.every((i: any) => i.assigneeId === null)).toBe(true);
    });

    it("priority.atLeast HIGH returns URGENT+HIGH (issue1, issue3), not MEDIUM/LOW", async () => {
      const res = await execute(tokenA, { v: 1, priority: { atLeast: "HIGH" } }).expect(200);
      const ids = res.body.items.map((i: any) => i.id);
      expect(ids.sort()).toEqual([issue1Id, issue3Id].sort());
    });

    it("labels.any matches issue1 via label1", async () => {
      const res = await execute(tokenA, { v: 1, labels: { any: [label1Id] } }).expect(200);
      expect(res.body.items.map((i: any) => i.id)).toEqual([issue1Id]);
      expect(res.body.items[0].labelIds).toContain(label1Id);
    });

    it("due.overdue returns issue5 (due yesterday, status TODO), not issue1 (due tomorrow)", async () => {
      const res = await execute(tokenA, { v: 1, due: { overdue: true } }).expect(200);
      expect(res.body.items.map((i: any) => i.id)).toEqual([issue5Id]);
    });

    it("due.withinDays(2) returns issue1 (due tomorrow) but not issue5 (already overdue) or issue3 (+20d)", async () => {
      const res = await execute(tokenA, { v: 1, due: { withinDays: 2 } }).expect(200);
      expect(res.body.items.map((i: any) => i.id)).toEqual([issue1Id]);
    });

    it("a member (not just the owner) gets the same results", async () => {
      const res = await execute(tokenB, { v: 1, type: { in: ["BUG"] } }).expect(200);
      expect(res.body.items.map((i: any) => i.id)).toEqual([issue1Id]);
    });

    it("a non-member gets 403", async () => {
      await execute(tokenD, { v: 1 }).expect(403);
    });
  });

  describe("text clause -> FTS, including stemming", () => {
    it("plain word match ('slow') finds issue3", async () => {
      const res = await execute(tokenA, { v: 1, text: "slow" }).expect(200);
      expect(res.body.items.map((i: any) => i.id)).toContain(issue3Id);
    });

    it("stemming: q=running matches a title containing 'run' (issue3)", async () => {
      const res = await execute(tokenA, { v: 1, text: "running" }).expect(200);
      expect(res.body.items.map((i: any) => i.id)).toContain(issue3Id);
    });

    it("text composes with a project filter (scoped to P2, 'running' still matches issue3, not issue4)", async () => {
      const res = await execute(tokenA, {
        v: 1,
        project: { in: [project2Id] },
        text: "running",
      }).expect(200);
      expect(res.body.items.map((i: any) => i.id)).toEqual([issue3Id]);
    });

    it("garbage/special-character text doesn't 500", async () => {
      const res = await execute(tokenA, {
        v: 1,
        text: '"unterminated quote AND !!! -- ; DROP TABLE',
      }).expect(200);
      expect(Array.isArray(res.body.items)).toBe(true);
    });
  });

  describe("ranking / orderBy", () => {
    it("no text, no explicit order -> work order: URGENT (issue1) sorts first", async () => {
      const res = await execute(tokenA, { v: 1 }).expect(200);
      expect(res.body.items[0].id).toBe(issue1Id);
    });

    it("order: due sorts ascending with nulls last (issue5 [yesterday], issue1 [tomorrow], issue3 [+20d], then the two null-due issues)", async () => {
      const res = await execute(tokenA, { v: 1, order: "due" }).expect(200);
      const ids = res.body.items.map((i: any) => i.id);
      expect(ids[0]).toBe(issue5Id);
      expect(ids[1]).toBe(issue1Id);
      expect(ids[2]).toBe(issue3Id);
      // The two null-due issues (issue2, issue4) come last, in either order.
      expect(ids.slice(3).sort()).toEqual([issue2Id, issue4Id].sort());
      expect(res.body.items.slice(3).every((i: any) => i.dueDate === null)).toBe(true);
    });

    it("order: priority sorts URGENT first regardless of due date", async () => {
      const res = await execute(tokenA, { v: 1, order: "priority" }).expect(200);
      expect(res.body.items[0].id).toBe(issue1Id);
      expect(res.body.items[0].priority).toBe("URGENT");
    });
  });

  describe("cursor pagination", () => {
    it("paginates the standard (non-text) path with limit=1, visiting every open issue exactly once", async () => {
      const collected: string[] = [];
      let cursor: string | undefined;
      for (let i = 0; i < 10; i++) {
        const res = await execute(tokenA, { v: 1, status: { not: "DONE" } }, { limit: 1, cursor }).expect(200);
        collected.push(...res.body.items.map((it: any) => it.id));
        cursor = res.body.nextCursor ?? undefined;
        if (!cursor) break;
      }
      // Open (not DONE) issues: issue1, issue3, issue4, issue5 (issue2 is DONE).
      expect(collected.sort()).toEqual([issue1Id, issue3Id, issue4Id, issue5Id].sort());
      expect(new Set(collected).size).toBe(collected.length); // no duplicates
    });

    it("paginates the text/rank-ordered path with limit=1, visiting every match exactly once", async () => {
      const collected: string[] = [];
      let cursor: string | undefined;
      for (let i = 0; i < 10; i++) {
        const res = await execute(tokenA, { v: 1, text: "release" }, { limit: 1, cursor }).expect(200);
        collected.push(...res.body.items.map((it: any) => it.id));
        cursor = res.body.nextCursor ?? undefined;
        if (!cursor) break;
      }
      // "release" appears in issue1, issue3, issue4's descriptions only.
      expect(collected.sort()).toEqual([issue1Id, issue3Id, issue4Id].sort());
      expect(new Set(collected).size).toBe(collected.length);
    });
  });

  describe("SECURITY REGRESSION — a foreign-workspace id anywhere in the AST never leaks/widens scope", () => {
    it("a foreign project.in id is dropped: results are ALL of workspace1's issues, never the foreign project's", async () => {
      const res = await execute(tokenA, { v: 1, project: { in: [foreignProjectId] } }).expect(200);
      expect(res.body.items).toHaveLength(5);
      expect(res.body.items.every((i: any) => [project1Id, project2Id].includes(i.projectId))).toBe(true);
      expect(res.body.items.some((i: any) => i.title === foreignIssueTitle)).toBe(false);
    });

    it("a foreign assignee.in id (a real user, just not a workspace1 member) is dropped: same full workspace1 result set", async () => {
      const res = await execute(tokenA, { v: 1, assignee: { in: [userCId] } }).expect(200);
      expect(res.body.items).toHaveLength(5);
      expect(res.body.items.some((i: any) => i.title === foreignIssueTitle)).toBe(false);
    });

    it("a foreign labels.any id is dropped: same full workspace1 result set, no crash", async () => {
      const res = await execute(tokenA, { v: 1, labels: { any: [foreignLabelId] } }).expect(200);
      expect(res.body.items).toHaveLength(5);
      expect(res.body.items.some((i: any) => i.title === foreignIssueTitle)).toBe(false);
    });

    it("multiple foreign ids combined with ONE legitimate clause: foreign clauses drop, the legitimate clause still applies", async () => {
      const res = await execute(tokenA, {
        v: 1,
        project: { in: [foreignProjectId] },
        assignee: { in: [userCId] },
        labels: { any: [foreignLabelId] },
        type: { in: ["BUG"] },
      }).expect(200);
      // Only the real `type: BUG` clause should have any effect -> issue1 only.
      expect(res.body.items.map((i: any) => i.id)).toEqual([issue1Id]);
    });

    it("a foreign project id can never be used to read the foreign issue via workspace1's own workspaceId", async () => {
      const res = await execute(tokenA, { v: 1, project: { in: [foreignProjectId] }, text: "secret" }).expect(200);
      expect(res.body.items).toEqual([]);
    });

    it("non-member (userD) is 403'd even with an otherwise-empty AST", async () => {
      await execute(tokenD, { v: 1 }).expect(403);
    });
  });
});
