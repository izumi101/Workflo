import { Test } from "@nestjs/testing";
import type { WorkfloQuery } from "@workflo/shared";
import { QueryCompilerService, type CompileContext } from "./query-compiler.service.js";
import { PrismaService } from "../prisma/prisma.service.js";

describe("QueryCompilerService", () => {
  let service: QueryCompilerService;

  const prismaMock = {
    project: { findMany: jest.fn() },
    workspaceMember: { findMany: jest.fn() },
    label: { findMany: jest.fn() },
  };

  const NOW = new Date("2026-07-09T12:00:00.000Z");
  const baseCtx: CompileContext = {
    workspaceId: "ws_1",
    userId: "user_1",
    now: NOW,
    tzOffsetMinutes: 0,
  };

  const ast = (overrides: Partial<WorkfloQuery> = {}): WorkfloQuery => ({ v: 1, ...overrides });

  beforeEach(async () => {
    jest.resetAllMocks();

    const moduleRef = await Test.createTestingModule({
      providers: [QueryCompilerService, { provide: PrismaService, useValue: prismaMock }],
    }).compile();

    service = moduleRef.get(QueryCompilerService);
  });

  describe("invariant 1 — workspace scope is always server-supplied and always first", () => {
    it("where.AND[0] is always {project: {workspaceId}}, for a bare/empty AST", async () => {
      const compiled = await service.compileQuery(ast(), baseCtx);
      const conditions = (compiled.where as any).AND;
      expect(conditions[0]).toEqual({ project: { workspaceId: "ws_1" } });
    });

    it("where.AND[0] is still the server workspace scope even when other clauses are present", async () => {
      const compiled = await service.compileQuery(ast({ type: { in: ["BUG"] } }), baseCtx);
      const conditions = (compiled.where as any).AND;
      expect(conditions[0]).toEqual({ project: { workspaceId: "ws_1" } });
    });

    it("a different workspaceId in ctx changes the scope (proving it's ctx-driven, not hardcoded)", async () => {
      const compiled = await service.compileQuery(ast(), { ...baseCtx, workspaceId: "ws_2" });
      const conditions = (compiled.where as any).AND;
      expect(conditions[0]).toEqual({ project: { workspaceId: "ws_2" } });
    });
  });

  describe("invariant 2 — every AST id is validated against the workspace; invalid ids are dropped + warned, never widen scope", () => {
    it("project.in: all-valid ids pass through unchanged, no warning", async () => {
      prismaMock.project.findMany.mockResolvedValue([{ id: "p1" }, { id: "p2" }]);

      const compiled = await service.compileQuery(ast({ project: { in: ["p1", "p2"] } }), baseCtx);

      const conditions = (compiled.where as any).AND;
      expect(conditions).toContainEqual({ projectId: { in: ["p1", "p2"] } });
      expect(compiled.warnings).toEqual([]);
      // Validated scoped to the caller's workspace, not globally.
      expect(prismaMock.project.findMany).toHaveBeenCalledWith({
        where: { id: { in: ["p1", "p2"] }, workspaceId: "ws_1" },
        select: { id: true },
      });
    });

    it("project.in: a foreign id is dropped from the clause and produces an invalid_id warning; caller's own id is kept", async () => {
      // Only "p1" belongs to ws_1 — "foreign-p" does not (simulates a
      // project id from another workspace, e.g. the 2026-07-04
      // issue-key-collision scenario).
      prismaMock.project.findMany.mockResolvedValue([{ id: "p1" }]);

      const compiled = await service.compileQuery(ast({ project: { in: ["p1", "foreign-p"] } }), baseCtx);

      const conditions = (compiled.where as any).AND;
      expect(conditions).toContainEqual({ projectId: { in: ["p1"] } });
      expect(compiled.warnings).toContainEqual({ field: "project", kind: "invalid_id", ids: ["foreign-p"] });
    });

    it("project.in: ALL-foreign ids drop the whole clause (never compiles to an always-false filter), still warns", async () => {
      prismaMock.project.findMany.mockResolvedValue([]);

      const compiled = await service.compileQuery(ast({ project: { in: ["foreign-a", "foreign-b"] } }), baseCtx);

      const conditions = (compiled.where as any).AND;
      expect(conditions.some((c: any) => "projectId" in c)).toBe(false);
      expect(compiled.warnings).toContainEqual({
        field: "project",
        kind: "invalid_id",
        ids: ["foreign-a", "foreign-b"],
      });
    });

    it("assignee.in: validates against workspaceMember, drops foreign userId", async () => {
      prismaMock.workspaceMember.findMany.mockResolvedValue([{ userId: "u1" }]);

      const compiled = await service.compileQuery(
        ast({ assignee: { in: ["u1", "foreign-user"] } }),
        baseCtx,
      );

      const conditions = (compiled.where as any).AND;
      expect(conditions).toContainEqual({ assigneeId: { in: ["u1"] } });
      expect(compiled.warnings).toContainEqual({
        field: "assignee",
        kind: "invalid_id",
        ids: ["foreign-user"],
      });
      expect(prismaMock.workspaceMember.findMany).toHaveBeenCalledWith({
        where: { userId: { in: ["u1", "foreign-user"] }, workspaceId: "ws_1" },
        select: { userId: true },
      });
    });

    it("reporter.in: validates against workspaceMember, drops foreign userId", async () => {
      prismaMock.workspaceMember.findMany.mockResolvedValue([{ userId: "u1" }]);

      const compiled = await service.compileQuery(
        ast({ reporter: { in: ["u1", "foreign-user"] } }),
        baseCtx,
      );

      const conditions = (compiled.where as any).AND;
      expect(conditions).toContainEqual({ reporterId: { in: ["u1"] } });
      expect(compiled.warnings).toContainEqual({
        field: "reporter",
        kind: "invalid_id",
        ids: ["foreign-user"],
      });
    });

    it("labels.any: validates against the workspace's labels, drops foreign labelId", async () => {
      prismaMock.label.findMany.mockResolvedValue([{ id: "l1" }]);

      const compiled = await service.compileQuery(ast({ labels: { any: ["l1", "foreign-l"] } }), baseCtx);

      const conditions = (compiled.where as any).AND;
      expect(conditions).toContainEqual({ labels: { some: { id: { in: ["l1"] } } } });
      expect(compiled.warnings).toContainEqual({ field: "labels", kind: "invalid_id", ids: ["foreign-l"] });
      expect(prismaMock.label.findMany).toHaveBeenCalledWith({
        where: { id: { in: ["l1", "foreign-l"] }, project: { workspaceId: "ws_1" } },
        select: { id: true },
      });
    });

    it("labels.all: one `some: {id}` clause per validated label, foreign ids dropped", async () => {
      prismaMock.label.findMany.mockResolvedValue([{ id: "l1" }, { id: "l2" }]);

      const compiled = await service.compileQuery(
        ast({ labels: { all: ["l1", "l2", "foreign-l"] } }),
        baseCtx,
      );

      const conditions = (compiled.where as any).AND;
      expect(conditions).toContainEqual({ labels: { some: { id: "l1" } } });
      expect(conditions).toContainEqual({ labels: { some: { id: "l2" } } });
      expect(conditions.some((c: any) => c?.labels?.some?.id === "foreign-l")).toBe(false);
      expect(compiled.warnings).toContainEqual({ field: "labels", kind: "invalid_id", ids: ["foreign-l"] });
    });
  });

  describe("symbolic identity resolution", () => {
    it('assignee: "me" resolves to ctx.userId', async () => {
      const compiled = await service.compileQuery(ast({ assignee: "me" }), baseCtx);
      expect((compiled.where as any).AND).toContainEqual({ assigneeId: "user_1" });
    });

    it('assignee: "unassigned" resolves to assigneeId: null (invariant 4)', async () => {
      const compiled = await service.compileQuery(ast({ assignee: "unassigned" }), baseCtx);
      expect((compiled.where as any).AND).toContainEqual({ assigneeId: null });
    });

    it('reporter: "me" resolves to ctx.userId', async () => {
      const compiled = await service.compileQuery(ast({ reporter: "me" }), baseCtx);
      expect((compiled.where as any).AND).toContainEqual({ reporterId: "user_1" });
    });

    it("a different ctx.userId changes the resolved 'me' (proving it's ctx-driven, not hardcoded)", async () => {
      const compiled = await service.compileQuery(ast({ assignee: "me" }), { ...baseCtx, userId: "user_2" });
      expect((compiled.where as any).AND).toContainEqual({ assigneeId: "user_2" });
    });
  });

  describe("status / priority / type", () => {
    it("status.in passes through", async () => {
      const compiled = await service.compileQuery(ast({ status: { in: ["TODO", "IN_PROGRESS"] } }), baseCtx);
      expect((compiled.where as any).AND).toContainEqual({ status: { in: ["TODO", "IN_PROGRESS"] } });
    });

    it("status.not DONE", async () => {
      const compiled = await service.compileQuery(ast({ status: { not: "DONE" } }), baseCtx);
      expect((compiled.where as any).AND).toContainEqual({ status: { not: "DONE" } });
    });

    it("priority.in passes through", async () => {
      const compiled = await service.compileQuery(ast({ priority: { in: ["URGENT"] } }), baseCtx);
      expect((compiled.where as any).AND).toContainEqual({ priority: { in: ["URGENT"] } });
    });

    it("priority.atLeast HIGH expands to [HIGH, URGENT]", async () => {
      const compiled = await service.compileQuery(ast({ priority: { atLeast: "HIGH" } }), baseCtx);
      expect((compiled.where as any).AND).toContainEqual({ priority: { in: ["HIGH", "URGENT"] } });
    });

    it("priority.atLeast LOW expands to the full order", async () => {
      const compiled = await service.compileQuery(ast({ priority: { atLeast: "LOW" } }), baseCtx);
      expect((compiled.where as any).AND).toContainEqual({
        priority: { in: ["LOW", "MEDIUM", "HIGH", "URGENT"] },
      });
    });

    it("type.in passes through", async () => {
      const compiled = await service.compileQuery(ast({ type: { in: ["BUG", "TASK"] } }), baseCtx);
      expect((compiled.where as any).AND).toContainEqual({ type: { in: ["BUG", "TASK"] } });
    });
  });

  describe("symbolic time resolution (fixed now)", () => {
    it("due.overdue -> dueDate < now AND status != DONE", async () => {
      const compiled = await service.compileQuery(ast({ due: { overdue: true } }), baseCtx);
      const conditions = (compiled.where as any).AND;
      expect(conditions).toContainEqual({ dueDate: { lt: NOW } });
      expect(conditions).toContainEqual({ status: { not: "DONE" } });
    });

    it("due.withinDays(N) -> [now, now+N days] (forward-looking)", async () => {
      const compiled = await service.compileQuery(ast({ due: { withinDays: 3 } }), baseCtx);
      const conditions = (compiled.where as any).AND;
      expect(conditions).toContainEqual({
        dueDate: { gte: NOW, lte: new Date("2026-07-12T12:00:00.000Z") },
      });
    });

    it("due.olderThanDays(N) -> dueDate < now-N days", async () => {
      const compiled = await service.compileQuery(ast({ due: { olderThanDays: 2 } }), baseCtx);
      const conditions = (compiled.where as any).AND;
      expect(conditions).toContainEqual({ dueDate: { lt: new Date("2026-07-07T12:00:00.000Z") } });
    });

    it("due.between passes the two ISO bounds through as Dates", async () => {
      const compiled = await service.compileQuery(
        ast({ due: { between: ["2026-01-01T00:00:00.000Z", "2026-01-31T23:59:59.999Z"] } }),
        baseCtx,
      );
      const conditions = (compiled.where as any).AND;
      expect(conditions).toContainEqual({
        dueDate: { gte: new Date("2026-01-01T00:00:00.000Z"), lte: new Date("2026-01-31T23:59:59.999Z") },
      });
    });

    it("updated.withinDays(N) -> [now-N days, now] (backward-looking — opposite direction from due)", async () => {
      const compiled = await service.compileQuery(ast({ updated: { withinDays: 7 } }), baseCtx);
      const conditions = (compiled.where as any).AND;
      expect(conditions).toContainEqual({
        updatedAt: { gte: new Date("2026-07-02T12:00:00.000Z"), lte: NOW },
      });
    });

    it("updated.olderThanDays(7) -> the 'stale' definition: updatedAt < now-7d", async () => {
      const compiled = await service.compileQuery(ast({ updated: { olderThanDays: 7 } }), baseCtx);
      const conditions = (compiled.where as any).AND;
      expect(conditions).toContainEqual({ updatedAt: { lt: new Date("2026-07-02T12:00:00.000Z") } });
    });

    it("created.withinDays(N) -> [now-N days, now]", async () => {
      const compiled = await service.compileQuery(ast({ created: { withinDays: 1 } }), baseCtx);
      const conditions = (compiled.where as any).AND;
      expect(conditions).toContainEqual({
        createdAt: { gte: new Date("2026-07-08T12:00:00.000Z"), lte: NOW },
      });
    });

    it("a different ctx.now shifts the resolved range (proving it's ctx-driven, not wall-clock)", async () => {
      const otherNow = new Date("2020-01-10T00:00:00.000Z");
      const compiled = await service.compileQuery(ast({ updated: { olderThanDays: 5 } }), {
        ...baseCtx,
        now: otherNow,
      });
      const conditions = (compiled.where as any).AND;
      expect(conditions).toContainEqual({ updatedAt: { lt: new Date("2020-01-05T00:00:00.000Z") } });
    });
  });

  describe("orderBy — ranking (§2.5)", () => {
    it("no text, no explicit order -> smart work order (priority desc, dueDate asc nulls-last, updatedAt desc, id desc)", async () => {
      const compiled = await service.compileQuery(ast(), baseCtx);
      expect(compiled.orderBy).toEqual([
        { priority: "desc" },
        { dueDate: { sort: "asc", nulls: "last" } },
        { updatedAt: "desc" },
        { id: "desc" },
      ]);
    });

    it("text present, no explicit order -> the 'rank' sentinel (FTS relevance, handled by the execution layer)", async () => {
      const compiled = await service.compileQuery(ast({ text: "login bug" }), baseCtx);
      expect(compiled.orderBy).toBe("rank");
    });

    it("explicit order overrides the no-text default", async () => {
      const compiled = await service.compileQuery(ast({ order: "due" }), baseCtx);
      expect(compiled.orderBy).toEqual([{ dueDate: { sort: "asc", nulls: "last" } }, { id: "desc" }]);
    });

    it("explicit order overrides rank even when text is present", async () => {
      const compiled = await service.compileQuery(ast({ text: "login", order: "updated" }), baseCtx);
      expect(compiled.orderBy).toEqual([{ updatedAt: "desc" }, { id: "desc" }]);
    });

    it("order: smart behaves exactly like unset (no text)", async () => {
      const compiled = await service.compileQuery(ast({ order: "smart" }), baseCtx);
      expect(compiled.orderBy).toEqual([
        { priority: "desc" },
        { dueDate: { sort: "asc", nulls: "last" } },
        { updatedAt: "desc" },
        { id: "desc" },
      ]);
    });

    it("order: priority", async () => {
      const compiled = await service.compileQuery(ast({ order: "priority" }), baseCtx);
      expect(compiled.orderBy).toEqual([{ priority: "desc" }, { id: "desc" }]);
    });

    it("order: created", async () => {
      const compiled = await service.compileQuery(ast({ order: "created" }), baseCtx);
      expect(compiled.orderBy).toEqual([{ createdAt: "desc" }, { id: "desc" }]);
    });
  });

  describe("ftsTerm", () => {
    it("is undefined when `text` is absent", async () => {
      const compiled = await service.compileQuery(ast(), baseCtx);
      expect(compiled.ftsTerm).toBeUndefined();
    });

    it("is the trimmed text when present", async () => {
      const compiled = await service.compileQuery(ast({ text: "  login bug  " }), baseCtx);
      expect(compiled.ftsTerm).toBe("login bug");
    });

    it("is undefined for a whitespace-only text", async () => {
      const compiled = await service.compileQuery(ast({ text: "   " }), baseCtx);
      expect(compiled.ftsTerm).toBeUndefined();
    });
  });
});
