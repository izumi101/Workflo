import { NotFoundException } from "@nestjs/common";
import { Test } from "@nestjs/testing";
import type { Priority, QueryResult, TriageSectionKey } from "@workflo/shared";
import { TriageService } from "./triage.service.js";
import { TriageCacheService } from "./triage-cache.service.js";
import { PrismaService } from "../prisma/prisma.service.js";
import { QueryExecutionService } from "../query/query-execution.service.js";

function makeResult(overrides: Partial<QueryResult> = {}): QueryResult {
  return {
    id: "issue_1",
    key: "WF-1",
    title: "Some issue",
    status: "TODO",
    priority: "MEDIUM",
    projectId: "proj_1",
    assigneeId: "user_1",
    dueDate: null,
    updatedAt: new Date("2026-07-01T00:00:00.000Z"),
    labelIds: [],
    type: "TASK",
    ...overrides,
  };
}

describe("TriageService", () => {
  let service: TriageService;

  const prismaMock = {
    issue: {
      findUnique: jest.fn(),
      findMany: jest.fn(),
    },
    triageDismissal: {
      findMany: jest.fn(),
      upsert: jest.fn(),
    },
    triageSeen: {
      findUnique: jest.fn(),
      upsert: jest.fn(),
    },
    $queryRaw: jest.fn(),
  };

  const queryExecutionMock = {
    execute: jest.fn(),
  };

  const cacheMock = {
    get: jest.fn(),
    set: jest.fn(),
    del: jest.fn(),
  };

  const now = new Date("2026-07-22T12:00:00.000Z");

  beforeEach(async () => {
    jest.resetAllMocks();

    // Defaults so an unconfigured test doesn't throw on unexpected calls.
    cacheMock.get.mockResolvedValue(null);
    cacheMock.set.mockResolvedValue(undefined);
    cacheMock.del.mockResolvedValue(undefined);
    queryExecutionMock.execute.mockResolvedValue({ items: [], nextCursor: null });
    prismaMock.$queryRaw.mockResolvedValue([]);
    prismaMock.issue.findMany.mockResolvedValue([]);
    prismaMock.triageDismissal.findMany.mockResolvedValue([]);
    prismaMock.triageSeen.findUnique.mockResolvedValue(null);

    const moduleRef = await Test.createTestingModule({
      providers: [
        TriageService,
        { provide: PrismaService, useValue: prismaMock },
        { provide: QueryExecutionService, useValue: queryExecutionMock },
        { provide: TriageCacheService, useValue: cacheMock },
      ],
    }).compile();

    service = moduleRef.get(TriageService);
  });

  describe("compute (section order, ASTs, caps)", () => {
    it("runs the 3 AST-backed sections through QueryExecutionService with the exact canned ASTs, requesting cap+25 rows", async () => {
      await service.getTriage("ws_1", "user_1", now, 0);

      expect(queryExecutionMock.execute).toHaveBeenCalledTimes(3);

      const [overdueAst, overdueCtx, overdueCursor, overdueLimit] = queryExecutionMock.execute.mock.calls[0]!;
      expect(overdueAst).toEqual({ v: 1, assignee: "me", status: { not: "DONE" }, due: { overdue: true } });
      expect(overdueCtx).toEqual({ workspaceId: "ws_1", userId: "user_1", now, tzOffsetMinutes: 0 });
      expect(overdueCursor).toBeUndefined();
      expect(overdueLimit).toBe(35); // cap 10 + 25 slack

      const [staleAst, , , staleLimit] = queryExecutionMock.execute.mock.calls[1]!;
      expect(staleAst).toEqual({ v: 1, assignee: "me", status: { not: "DONE" }, updated: { olderThanDays: 7 } });
      expect(staleLimit).toBe(35);

      const [unownedAst, , , unownedLimit] = queryExecutionMock.execute.mock.calls[2]!;
      expect(unownedAst).toEqual({ v: 1, assignee: "unassigned", priority: { atLeast: "HIGH" }, status: { not: "DONE" } });
      expect(unownedLimit).toBe(30); // cap 5 + 25 slack
    });

    it("returns sections in fixed order (OVERDUE, GOING_STALE, NEEDS_REPLY, UNOWNED_URGENT) when all are non-empty, with NEEDS_REPLY's ast null", async () => {
      queryExecutionMock.execute.mockResolvedValueOnce({ items: [makeResult({ id: "o1" })], nextCursor: null }); // OVERDUE
      queryExecutionMock.execute.mockResolvedValueOnce({ items: [makeResult({ id: "s1" })], nextCursor: null }); // GOING_STALE
      queryExecutionMock.execute.mockResolvedValueOnce({ items: [makeResult({ id: "u1" })], nextCursor: null }); // UNOWNED_URGENT
      prismaMock.$queryRaw.mockResolvedValue([{ id: "n1" }]);
      prismaMock.issue.findMany.mockResolvedValue([
        { id: "n1", number: 1, title: "t", status: "TODO", priority: "MEDIUM", projectId: "p1", assigneeId: null, dueDate: null, updatedAt: now, labels: [], type: "TASK", project: { key: "WF" } },
      ]);

      const result = await service.getTriage("ws_1", "user_1", now, 0);

      expect(result.sections.map((s) => s.key)).toEqual(["OVERDUE", "GOING_STALE", "NEEDS_REPLY", "UNOWNED_URGENT"]);
      const needsReply = result.sections.find((s) => s.key === "NEEDS_REPLY")!;
      expect(needsReply.ast).toBeNull();
      expect(needsReply.items).toHaveLength(1);
      expect(needsReply.items[0]!.id).toBe("n1");
    });

    it("drops empty sections from the response entirely", async () => {
      queryExecutionMock.execute.mockResolvedValueOnce({ items: [makeResult({ id: "o1" })], nextCursor: null }); // OVERDUE
      queryExecutionMock.execute.mockResolvedValueOnce({ items: [], nextCursor: null }); // GOING_STALE empty
      queryExecutionMock.execute.mockResolvedValueOnce({ items: [], nextCursor: null }); // UNOWNED_URGENT empty
      // NEEDS_REPLY stays empty via default $queryRaw mock ([])

      const result = await service.getTriage("ws_1", "user_1", now, 0);

      expect(result.sections.map((s) => s.key)).toEqual(["OVERDUE"]);
    });

    it("truncates a section to its own cap even when the global budget would allow more", async () => {
      const overdueRows = Array.from({ length: 15 }, (_, i) => makeResult({ id: `o${i}` }));
      queryExecutionMock.execute.mockResolvedValueOnce({ items: overdueRows, nextCursor: null }); // OVERDUE (cap 10)
      queryExecutionMock.execute.mockResolvedValueOnce({ items: [], nextCursor: null });
      queryExecutionMock.execute.mockResolvedValueOnce({ items: [], nextCursor: null });

      const result = await service.getTriage("ws_1", "user_1", now, 0);

      const overdue = result.sections.find((s) => s.key === "OVERDUE")!;
      expect(overdue.items).toHaveLength(10);
    });

    it("applies a global 25-row budget across sections in order, truncating/dropping later sections", async () => {
      const overdueRows = Array.from({ length: 10 }, (_, i) => makeResult({ id: `o${i}` }));
      const staleRows = Array.from({ length: 10 }, (_, i) => makeResult({ id: `s${i}` }));
      const unownedRows = Array.from({ length: 5 }, (_, i) => makeResult({ id: `u${i}` }));
      queryExecutionMock.execute.mockResolvedValueOnce({ items: overdueRows, nextCursor: null });
      queryExecutionMock.execute.mockResolvedValueOnce({ items: staleRows, nextCursor: null });
      queryExecutionMock.execute.mockResolvedValueOnce({ items: unownedRows, nextCursor: null });

      const needsReplyIds = Array.from({ length: 10 }, (_, i) => `n${i}`);
      prismaMock.$queryRaw.mockResolvedValue(needsReplyIds.map((id) => ({ id })));
      prismaMock.issue.findMany.mockResolvedValue(
        needsReplyIds.map((id, i) => ({
          id,
          number: i + 1,
          title: "t",
          status: "TODO",
          priority: "MEDIUM",
          projectId: "p1",
          assigneeId: null,
          dueDate: null,
          updatedAt: now,
          labels: [],
          type: "TASK",
          project: { key: "WF" },
        })),
      );

      const result = await service.getTriage("ws_1", "user_1", now, 0);

      const byKey = Object.fromEntries(result.sections.map((s) => [s.key, s.items.length]));
      expect(byKey["OVERDUE"]).toBe(10);
      expect(byKey["GOING_STALE"]).toBe(10);
      expect(byKey["NEEDS_REPLY"]).toBe(5); // only 5 of the global 25-row budget left
      expect(byKey["UNOWNED_URGENT"]).toBeUndefined(); // budget exhausted -> dropped entirely

      const total = result.sections.flatMap((s) => s.items).length;
      expect(total).toBe(25);
    });
  });

  describe("dismissal suppression + escalation-undo", () => {
    function activeDismissal(overrides: { section: TriageSectionKey; priorityAtDismiss: Priority; wasOverdueAtDismiss: boolean }) {
      return { issueId: "o0", ...overrides };
    }

    it("suppresses a row with an active, non-escalated dismissal", async () => {
      queryExecutionMock.execute.mockResolvedValueOnce({
        items: [makeResult({ id: "o0", priority: "MEDIUM", dueDate: null })],
        nextCursor: null,
      });
      queryExecutionMock.execute.mockResolvedValueOnce({ items: [], nextCursor: null });
      queryExecutionMock.execute.mockResolvedValueOnce({ items: [], nextCursor: null });
      prismaMock.triageDismissal.findMany.mockResolvedValue([
        activeDismissal({ section: "OVERDUE", priorityAtDismiss: "MEDIUM", wasOverdueAtDismiss: false }),
      ]);

      const result = await service.getTriage("ws_1", "user_1", now, 0);

      expect(result.sections.find((s) => s.key === "OVERDUE")).toBeUndefined();
    });

    it("shows a dismissed row again if its priority has since been raised (escalation)", async () => {
      queryExecutionMock.execute.mockResolvedValueOnce({
        items: [makeResult({ id: "o0", priority: "URGENT", dueDate: null })],
        nextCursor: null,
      });
      queryExecutionMock.execute.mockResolvedValueOnce({ items: [], nextCursor: null });
      queryExecutionMock.execute.mockResolvedValueOnce({ items: [], nextCursor: null });
      prismaMock.triageDismissal.findMany.mockResolvedValue([
        activeDismissal({ section: "OVERDUE", priorityAtDismiss: "MEDIUM", wasOverdueAtDismiss: false }),
      ]);

      const result = await service.getTriage("ws_1", "user_1", now, 0);

      const overdue = result.sections.find((s) => s.key === "OVERDUE");
      expect(overdue?.items.map((i) => i.id)).toContain("o0");
    });

    it("shows a dismissed row again if it has become overdue since the dismissal (wasOverdueAtDismiss was false)", async () => {
      const pastDue = new Date(now.getTime() - 1000);
      queryExecutionMock.execute.mockResolvedValueOnce({
        items: [makeResult({ id: "o0", priority: "MEDIUM", dueDate: pastDue })],
        nextCursor: null,
      });
      queryExecutionMock.execute.mockResolvedValueOnce({ items: [], nextCursor: null });
      queryExecutionMock.execute.mockResolvedValueOnce({ items: [], nextCursor: null });
      prismaMock.triageDismissal.findMany.mockResolvedValue([
        activeDismissal({ section: "OVERDUE", priorityAtDismiss: "MEDIUM", wasOverdueAtDismiss: false }),
      ]);

      const result = await service.getTriage("ws_1", "user_1", now, 0);

      const overdue = result.sections.find((s) => s.key === "OVERDUE");
      expect(overdue?.items.map((i) => i.id)).toContain("o0");
    });

    it("stays hidden when neither priority nor overdue-ness escalated", async () => {
      queryExecutionMock.execute.mockResolvedValueOnce({
        items: [makeResult({ id: "o0", priority: "MEDIUM", dueDate: null })],
        nextCursor: null,
      });
      queryExecutionMock.execute.mockResolvedValueOnce({ items: [], nextCursor: null });
      queryExecutionMock.execute.mockResolvedValueOnce({ items: [], nextCursor: null });
      prismaMock.triageDismissal.findMany.mockResolvedValue([
        activeDismissal({ section: "OVERDUE", priorityAtDismiss: "HIGH", wasOverdueAtDismiss: true }),
      ]);

      const result = await service.getTriage("ws_1", "user_1", now, 0);

      expect(result.sections.find((s) => s.key === "OVERDUE")).toBeUndefined();
    });

    it("only suppresses the matching section — the same issue id in a different section is unaffected", async () => {
      queryExecutionMock.execute.mockResolvedValueOnce({
        items: [makeResult({ id: "o0", priority: "MEDIUM", dueDate: null })],
        nextCursor: null,
      });
      queryExecutionMock.execute.mockResolvedValueOnce({
        items: [makeResult({ id: "o0", priority: "MEDIUM", dueDate: null })],
        nextCursor: null,
      });
      queryExecutionMock.execute.mockResolvedValueOnce({ items: [], nextCursor: null });
      prismaMock.triageDismissal.findMany.mockResolvedValue([
        activeDismissal({ section: "OVERDUE", priorityAtDismiss: "MEDIUM", wasOverdueAtDismiss: false }),
      ]);

      const result = await service.getTriage("ws_1", "user_1", now, 0);

      expect(result.sections.find((s) => s.key === "OVERDUE")).toBeUndefined();
      expect(result.sections.find((s) => s.key === "GOING_STALE")?.items.map((i) => i.id)).toContain("o0");
    });
  });

  describe("badge", () => {
    it("counts only final rows newer than the caller's lastSeenAt", async () => {
      const older = makeResult({ id: "old", updatedAt: new Date("2026-07-01T00:00:00.000Z") });
      const newer = makeResult({ id: "new", updatedAt: new Date("2026-07-22T00:00:00.000Z") });
      queryExecutionMock.execute.mockResolvedValueOnce({ items: [older, newer], nextCursor: null });
      queryExecutionMock.execute.mockResolvedValueOnce({ items: [], nextCursor: null });
      queryExecutionMock.execute.mockResolvedValueOnce({ items: [], nextCursor: null });
      prismaMock.triageSeen.findUnique.mockResolvedValue({
        id: "seen_1",
        userId: "user_1",
        workspaceId: "ws_1",
        lastSeenAt: new Date("2026-07-10T00:00:00.000Z"),
      });

      const result = await service.getTriage("ws_1", "user_1", now, 0);

      expect(result.badge).toBe(1);
    });

    it("equals the total row count when no TriageSeen row exists yet", async () => {
      queryExecutionMock.execute.mockResolvedValueOnce({ items: [makeResult({ id: "a" }), makeResult({ id: "b" })], nextCursor: null });
      queryExecutionMock.execute.mockResolvedValueOnce({ items: [], nextCursor: null });
      queryExecutionMock.execute.mockResolvedValueOnce({ items: [], nextCursor: null });
      prismaMock.triageSeen.findUnique.mockResolvedValue(null);

      const result = await service.getTriage("ws_1", "user_1", now, 0);

      expect(result.badge).toBe(2);
    });
  });

  describe("caching", () => {
    it("returns the cached response on a hit without recomputing (QueryExecutionService never called)", async () => {
      const cached = { sections: [], badge: 3 };
      cacheMock.get.mockResolvedValue(cached);

      const result = await service.getTriage("ws_1", "user_1", now, 0);

      expect(result).toBe(cached);
      expect(queryExecutionMock.execute).not.toHaveBeenCalled();
      expect(prismaMock.triageDismissal.findMany).not.toHaveBeenCalled();
    });

    it("caches the freshly computed result with a 60s TTL on a miss", async () => {
      cacheMock.get.mockResolvedValue(null);

      await service.getTriage("ws_1", "user_1", now, 0);

      expect(cacheMock.set).toHaveBeenCalledWith(
        TriageCacheService.cacheKey("ws_1", "user_1"),
        expect.objectContaining({ sections: expect.any(Array), badge: expect.any(Number) }),
        60,
      );
    });

    it("still returns a computed result when the cache throws (fail-open)", async () => {
      cacheMock.get.mockRejectedValue(new Error("redis down"));
      cacheMock.set.mockRejectedValue(new Error("redis down"));
      queryExecutionMock.execute.mockResolvedValueOnce({ items: [makeResult({ id: "a" })], nextCursor: null });
      queryExecutionMock.execute.mockResolvedValueOnce({ items: [], nextCursor: null });
      queryExecutionMock.execute.mockResolvedValueOnce({ items: [], nextCursor: null });

      const result = await service.getTriage("ws_1", "user_1", now, 0);

      expect(result.sections.length).toBeGreaterThan(0);
    });
  });

  describe("dismiss", () => {
    it("upserts a 7-day dismissal snapshotting priority + overdue-ness, then invalidates the cache for the issue's workspace", async () => {
      prismaMock.issue.findUnique.mockResolvedValue({
        priority: "HIGH",
        dueDate: new Date(now.getTime() - 1000),
        project: { workspaceId: "ws_1" },
      });

      const result = await service.dismiss("user_1", "issue_1", "OVERDUE", now);

      expect(result).toEqual({ ok: true });
      expect(prismaMock.triageDismissal.upsert).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { userId_issueId_section: { userId: "user_1", issueId: "issue_1", section: "OVERDUE" } },
          create: expect.objectContaining({ priorityAtDismiss: "HIGH", wasOverdueAtDismiss: true }),
          update: expect.objectContaining({ priorityAtDismiss: "HIGH", wasOverdueAtDismiss: true }),
        }),
      );
      const [key] = cacheMock.del.mock.calls[0]!;
      expect(key).toBe(TriageCacheService.cacheKey("ws_1", "user_1"));
    });

    it("throws NotFoundException for an unknown issue id", async () => {
      prismaMock.issue.findUnique.mockResolvedValue(null);

      await expect(service.dismiss("user_1", "ghost", "OVERDUE", now)).rejects.toBeInstanceOf(NotFoundException);
      expect(prismaMock.triageDismissal.upsert).not.toHaveBeenCalled();
    });
  });

  describe("markSeen", () => {
    it("upserts TriageSeen with the given now and invalidates the cache", async () => {
      const result = await service.markSeen("user_1", "ws_1", now);

      expect(result).toEqual({ ok: true });
      expect(prismaMock.triageSeen.upsert).toHaveBeenCalledWith({
        where: { userId_workspaceId: { userId: "user_1", workspaceId: "ws_1" } },
        create: { userId: "user_1", workspaceId: "ws_1", lastSeenAt: now },
        update: { lastSeenAt: now },
      });
      expect(cacheMock.del).toHaveBeenCalledWith(TriageCacheService.cacheKey("ws_1", "user_1"));
    });
  });
});
