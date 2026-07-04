import { BadRequestException, NotFoundException } from "@nestjs/common";
import { EventEmitter2 } from "@nestjs/event-emitter";
import { Test } from "@nestjs/testing";
import { IssuesService } from "./issues.service.js";
import { PrismaService } from "../prisma/prisma.service.js";

describe("IssuesService", () => {
  let service: IssuesService;
  let eventsMock: { emit: jest.Mock };

  const txMock = {
    project: { update: jest.fn() },
    issue: { findFirst: jest.fn(), create: jest.fn() },
  };

  const prismaMock = {
    $transaction: jest.fn((cb: (tx: typeof txMock) => unknown) => cb(txMock)),
    $queryRaw: jest.fn(),
    project: { findUnique: jest.fn() },
    issue: {
      findFirst: jest.fn(),
      findUnique: jest.fn(),
      findMany: jest.fn(),
      update: jest.fn(),
      delete: jest.fn(),
    },
    workspaceMember: { findUnique: jest.fn() },
    label: { findMany: jest.fn() },
  };

  const baseIssueRow = (overrides: Record<string, unknown> = {}) => ({
    id: "issue_1",
    projectId: "proj_1",
    number: 1,
    title: "Fix bug",
    description: null,
    type: "TASK",
    status: "TODO",
    priority: "MEDIUM",
    assigneeId: null,
    reporterId: "user_1",
    parentId: null,
    rank: "a0",
    dueDate: null,
    createdAt: new Date(),
    updatedAt: new Date(),
    labels: [],
    ...overrides,
  });

  beforeEach(async () => {
    jest.resetAllMocks();
    prismaMock.$transaction.mockImplementation((cb: (tx: typeof txMock) => unknown) => cb(txMock));
    eventsMock = { emit: jest.fn() };

    const moduleRef = await Test.createTestingModule({
      providers: [
        IssuesService,
        { provide: PrismaService, useValue: prismaMock },
        { provide: EventEmitter2, useValue: eventsMock },
      ],
    }).compile();

    service = moduleRef.get(IssuesService);
  });

  describe("create — human key allocation", () => {
    it("allocates sequential numbers via an atomic counter increment inside a transaction", async () => {
      prismaMock.project.findUnique.mockResolvedValue({ workspaceId: "ws_1" });

      // First create: counter goes 0 -> 1.
      txMock.project.update.mockResolvedValueOnce({ counter: 1 });
      txMock.issue.findFirst.mockResolvedValueOnce(null);
      txMock.issue.create.mockResolvedValueOnce(baseIssueRow({ number: 1 }));

      const first = await service.create("proj_1", "user_1", { title: "Issue A" } as any);
      expect(txMock.project.update).toHaveBeenCalledWith({
        where: { id: "proj_1" },
        data: { counter: { increment: 1 } },
        select: { counter: true },
      });
      expect(first.number).toBe(1);
      expect(eventsMock.emit).toHaveBeenCalledWith("issue.created", { projectId: "proj_1", issue: first });

      // Second create: counter goes 1 -> 2.
      txMock.project.update.mockResolvedValueOnce({ counter: 2 });
      txMock.issue.findFirst.mockResolvedValueOnce({ rank: "a0" });
      txMock.issue.create.mockResolvedValueOnce(baseIssueRow({ number: 2, id: "issue_2" }));

      const second = await service.create("proj_1", "user_1", { title: "Issue B" } as any);
      expect(second.number).toBe(2);
      expect(prismaMock.$transaction).toHaveBeenCalledTimes(2);
    });

    it("appends a rank strictly after the last issue in the TODO column via rankBetween", async () => {
      prismaMock.project.findUnique.mockResolvedValue({ workspaceId: "ws_1" });
      txMock.project.update.mockResolvedValueOnce({ counter: 3 });
      txMock.issue.findFirst.mockResolvedValueOnce({ rank: "a0" });
      txMock.issue.create.mockImplementationOnce(({ data }: any) =>
        Promise.resolve(baseIssueRow({ number: 3, rank: data.rank })),
      );

      await service.create("proj_1", "user_1", { title: "Issue C" } as any);

      const createCall = txMock.issue.create.mock.calls[0][0];
      expect(createCall.data.rank > "a0").toBe(true);
    });

    it("places the first issue in an empty column at an open-ended rank (no previous rank)", async () => {
      prismaMock.project.findUnique.mockResolvedValue({ workspaceId: "ws_1" });
      txMock.project.update.mockResolvedValueOnce({ counter: 1 });
      txMock.issue.findFirst.mockResolvedValueOnce(null);
      txMock.issue.create.mockImplementationOnce(({ data }: any) =>
        Promise.resolve(baseIssueRow({ number: 1, rank: data.rank })),
      );

      await service.create("proj_1", "user_1", { title: "Issue D" } as any);

      const createCall = txMock.issue.create.mock.calls[0][0];
      expect(typeof createCall.data.rank).toBe("string");
      expect(createCall.data.rank.length).toBeGreaterThan(0);
    });
  });

  describe("create — cross-project validation", () => {
    it("rejects an assigneeId that is not a member of the project's workspace", async () => {
      prismaMock.project.findUnique.mockResolvedValue({ workspaceId: "ws_1" });
      prismaMock.workspaceMember.findUnique.mockResolvedValue(null);

      await expect(
        service.create("proj_1", "user_1", { title: "X", assigneeId: "outsider" } as any),
      ).rejects.toBeInstanceOf(BadRequestException);
      expect(prismaMock.$transaction).not.toHaveBeenCalled();
    });

    it("rejects a parentId belonging to a different project", async () => {
      prismaMock.project.findUnique.mockResolvedValue({ workspaceId: "ws_1" });
      prismaMock.issue.findUnique.mockResolvedValueOnce({ projectId: "other_proj" });

      await expect(
        service.create("proj_1", "user_1", { title: "X", parentId: "epic_1" } as any),
      ).rejects.toBeInstanceOf(BadRequestException);
    });

    it("rejects labelIds that don't all belong to the project", async () => {
      prismaMock.project.findUnique.mockResolvedValue({ workspaceId: "ws_1" });
      prismaMock.label.findMany.mockResolvedValue([{ id: "label_1", projectId: "other_proj" }]);

      await expect(
        service.create("proj_1", "user_1", { title: "X", labelIds: ["label_1"] } as any),
      ).rejects.toBeInstanceOf(BadRequestException);
    });

    it("404s when the project doesn't exist", async () => {
      prismaMock.project.findUnique.mockResolvedValue(null);

      await expect(
        service.create("ghost_proj", "user_1", { title: "X" } as any),
      ).rejects.toBeInstanceOf(NotFoundException);
    });
  });

  describe("getByKey — key parsing", () => {
    it("parses a well-formed key and looks up by project key + number", async () => {
      prismaMock.issue.findFirst.mockResolvedValue(baseIssueRow());

      const result = await service.getByKey("WF-1");

      expect(prismaMock.issue.findFirst).toHaveBeenCalledWith(
        expect.objectContaining({ where: { number: 1, project: { key: "WF" } } }),
      );
      expect(result.number).toBe(1);
    });

    it("throws 400 on a malformed key", async () => {
      await expect(service.getByKey("not-a-key")).rejects.toBeInstanceOf(BadRequestException);
    });

    it("throws 404 when no issue matches", async () => {
      prismaMock.issue.findFirst.mockResolvedValue(null);
      await expect(service.getByKey("WF-999")).rejects.toBeInstanceOf(NotFoundException);
    });
  });

  describe("listByProject — filter query building", () => {
    it("builds a where clause from status/assigneeId/labelId filters (no q)", async () => {
      prismaMock.issue.findMany.mockResolvedValue([]);

      await service.listByProject("proj_1", {
        status: "IN_PROGRESS",
        assigneeId: "user_2",
        labelId: "label_1",
        limit: 25,
      } as any);

      expect(prismaMock.$queryRaw).not.toHaveBeenCalled();
      expect(prismaMock.issue.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: {
            projectId: "proj_1",
            status: "IN_PROGRESS",
            assigneeId: "user_2",
            labels: { some: { id: "label_1" } },
          },
          orderBy: [{ status: "asc" }, { rank: "asc" }],
          take: 26,
        }),
      );
    });

    it("resolves q via FTS ($queryRaw) and narrows the Prisma where by the matching ids", async () => {
      prismaMock.$queryRaw.mockResolvedValue([{ id: "issue_1" }, { id: "issue_2" }]);
      prismaMock.issue.findMany.mockResolvedValue([]);

      await service.listByProject("proj_1", {
        status: "IN_PROGRESS",
        q: "login bug",
        limit: 25,
      } as any);

      expect(prismaMock.$queryRaw).toHaveBeenCalledTimes(1);
      expect(prismaMock.issue.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: {
            projectId: "proj_1",
            status: "IN_PROGRESS",
            id: { in: ["issue_1", "issue_2"] },
          },
        }),
      );
    });

    it("short-circuits to an empty page when q matches zero issues, without calling findMany", async () => {
      prismaMock.$queryRaw.mockResolvedValue([]);

      const result = await service.listByProject("proj_1", { q: "nomatch", limit: 25 } as any);

      expect(prismaMock.issue.findMany).not.toHaveBeenCalled();
      expect(result).toEqual({ items: [], nextCursor: null });
    });

    it("omits optional filters when not provided", async () => {
      prismaMock.issue.findMany.mockResolvedValue([]);

      await service.listByProject("proj_1", { limit: 25 } as any);

      expect(prismaMock.issue.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ where: { projectId: "proj_1" } }),
      );
    });

    it("returns a nextCursor when more rows exist than the page limit", async () => {
      const rows = Array.from({ length: 3 }, (_, i) => baseIssueRow({ id: `issue_${i}`, number: i + 1 }));
      prismaMock.issue.findMany.mockResolvedValue(rows);

      const result = await service.listByProject("proj_1", { limit: 2 } as any);

      expect(result.items).toHaveLength(2);
      expect(result.nextCursor).toBe("issue_1");
    });
  });

  describe("update", () => {
    it("throws 404 when the issue key doesn't resolve", async () => {
      prismaMock.issue.findFirst.mockResolvedValue(null);
      await expect(service.update("WF-1", { title: "New" } as any)).rejects.toBeInstanceOf(
        NotFoundException,
      );
    });

    it("applies a partial update and validates cross-project refs", async () => {
      prismaMock.issue.findFirst.mockResolvedValueOnce({ id: "issue_1", projectId: "proj_1" }); // findRowByKey
      prismaMock.project.findUnique.mockResolvedValue({ workspaceId: "ws_1" });
      prismaMock.issue.update.mockResolvedValue(baseIssueRow({ status: "IN_PROGRESS" }));

      const result = await service.update("WF-1", { status: "IN_PROGRESS" } as any);

      expect(prismaMock.issue.update).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: "issue_1" },
          data: expect.objectContaining({ status: "IN_PROGRESS" }),
        }),
      );
      expect(result.status).toBe("IN_PROGRESS");
    });
  });

  describe("move", () => {
    it("computes a rank strictly between the after/before neighbors and updates status+rank atomically", async () => {
      prismaMock.issue.findFirst.mockResolvedValueOnce({ id: "issue_2", projectId: "proj_1" }); // findRowByKey
      prismaMock.issue.findUnique
        .mockResolvedValueOnce({ id: "before_1", projectId: "proj_1", status: "TODO", rank: "a2" }) // beforeIssueId
        .mockResolvedValueOnce({ id: "after_1", projectId: "proj_1", status: "TODO", rank: "a1" }); // afterIssueId
      prismaMock.issue.update.mockImplementationOnce(({ data }: any) =>
        Promise.resolve(baseIssueRow({ id: "issue_2", status: data.status, rank: data.rank })),
      );

      const result = await service.move("WF-2", {
        status: "TODO",
        beforeIssueId: "before_1",
        afterIssueId: "after_1",
      } as any);

      expect(prismaMock.issue.update).toHaveBeenCalledTimes(1);
      const updateCall = prismaMock.issue.update.mock.calls[0][0];
      expect(updateCall.where).toEqual({ id: "issue_2" });
      expect(updateCall.data.status).toBe("TODO");
      expect(updateCall.data.rank > "a1").toBe(true);
      expect(updateCall.data.rank < "a2").toBe(true);
      expect(result.status).toBe("TODO");
      expect(eventsMock.emit).toHaveBeenCalledWith("issue.moved", { projectId: "proj_1", issue: result });
    });

    it("places the issue at the end of the column when both neighbor ids are omitted", async () => {
      prismaMock.issue.findFirst.mockResolvedValueOnce({ id: "issue_1", projectId: "proj_1" });
      prismaMock.issue.update.mockImplementationOnce(({ data }: any) =>
        Promise.resolve(baseIssueRow({ id: "issue_1", status: data.status, rank: data.rank })),
      );

      await service.move("WF-1", { status: "DONE" } as any);

      expect(prismaMock.issue.findUnique).not.toHaveBeenCalled();
      const updateCall = prismaMock.issue.update.mock.calls[0][0];
      expect(updateCall.data.status).toBe("DONE");
      expect(typeof updateCall.data.rank).toBe("string");
    });

    it("rejects a neighbor issue that belongs to a different project (400)", async () => {
      prismaMock.issue.findFirst.mockResolvedValueOnce({ id: "issue_1", projectId: "proj_1" });
      prismaMock.issue.findUnique.mockResolvedValueOnce({
        id: "other_proj_issue",
        projectId: "proj_OTHER",
        status: "TODO",
        rank: "a1",
      });

      await expect(
        service.move("WF-1", { status: "TODO", beforeIssueId: "other_proj_issue" } as any),
      ).rejects.toBeInstanceOf(BadRequestException);
      expect(prismaMock.issue.update).not.toHaveBeenCalled();
    });

    it("rejects a neighbor issue that isn't in the target status column (400)", async () => {
      prismaMock.issue.findFirst.mockResolvedValueOnce({ id: "issue_1", projectId: "proj_1" });
      prismaMock.issue.findUnique.mockResolvedValueOnce({
        id: "wrong_status_issue",
        projectId: "proj_1",
        status: "DONE",
        rank: "a1",
      });

      await expect(
        service.move("WF-1", { status: "TODO", beforeIssueId: "wrong_status_issue" } as any),
      ).rejects.toBeInstanceOf(BadRequestException);
      expect(prismaMock.issue.update).not.toHaveBeenCalled();
    });

    it("rejects a neighbor id that doesn't resolve to any issue (400)", async () => {
      prismaMock.issue.findFirst.mockResolvedValueOnce({ id: "issue_1", projectId: "proj_1" });
      prismaMock.issue.findUnique.mockResolvedValueOnce(null);

      await expect(
        service.move("WF-1", { status: "TODO", afterIssueId: "ghost" } as any),
      ).rejects.toBeInstanceOf(BadRequestException);
    });

    it("throws 404 when the moved issue's key doesn't resolve", async () => {
      prismaMock.issue.findFirst.mockResolvedValueOnce(null);

      await expect(service.move("WF-999", { status: "TODO" } as any)).rejects.toBeInstanceOf(
        NotFoundException,
      );
    });
  });

  describe("remove", () => {
    it("deletes the issue resolved by key", async () => {
      prismaMock.issue.findFirst.mockResolvedValue({ id: "issue_1", projectId: "proj_1" });
      prismaMock.issue.delete.mockResolvedValue({});

      await service.remove("WF-1");

      expect(prismaMock.issue.delete).toHaveBeenCalledWith({ where: { id: "issue_1" } });
      expect(eventsMock.emit).toHaveBeenCalledWith("issue.deleted", {
        projectId: "proj_1",
        issueId: "issue_1",
      });
    });

    it("throws 404 when the issue doesn't exist", async () => {
      prismaMock.issue.findFirst.mockResolvedValue(null);
      await expect(service.remove("WF-999")).rejects.toBeInstanceOf(NotFoundException);
    });
  });
});
