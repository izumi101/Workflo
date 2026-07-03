import { BadRequestException, ForbiddenException, NotFoundException } from "@nestjs/common";
import { EventEmitter2 } from "@nestjs/event-emitter";
import { Test } from "@nestjs/testing";
import { CommentsService } from "./comments.service.js";
import { PrismaService } from "../prisma/prisma.service.js";

describe("CommentsService", () => {
  let service: CommentsService;
  let eventsMock: { emit: jest.Mock };

  const prismaMock = {
    issue: { findFirst: jest.fn() },
    comment: {
      findMany: jest.fn(),
      findUnique: jest.fn(),
      create: jest.fn(),
      update: jest.fn(),
      delete: jest.fn(),
    },
    workspaceMember: { findMany: jest.fn() },
  };

  const baseCommentRow = (overrides: Record<string, unknown> = {}) => ({
    id: "comment_1",
    issueId: "issue_1",
    authorId: "user_author",
    body: "Hello world",
    mentions: [],
    createdAt: new Date(),
    updatedAt: new Date(),
    author: { id: "user_author", name: "Author Name", avatarUrl: null },
    ...overrides,
  });

  beforeEach(async () => {
    jest.resetAllMocks();
    eventsMock = { emit: jest.fn() };

    const moduleRef = await Test.createTestingModule({
      providers: [
        CommentsService,
        { provide: PrismaService, useValue: prismaMock },
        { provide: EventEmitter2, useValue: eventsMock },
      ],
    }).compile();

    service = moduleRef.get(CommentsService);
  });

  describe("create — mentions validation", () => {
    it("creates a comment with no mentions when mentionUserIds is omitted", async () => {
      prismaMock.issue.findFirst.mockResolvedValue({
        id: "issue_1",
        projectId: "proj_1",
        project: { workspaceId: "ws_1" },
      });
      prismaMock.comment.create.mockResolvedValue(baseCommentRow());

      const result = await service.create("WF-1", "user_author", { body: "Hello world" });

      expect(prismaMock.workspaceMember.findMany).not.toHaveBeenCalled();
      expect(prismaMock.comment.create).toHaveBeenCalledWith(
        expect.objectContaining({ data: expect.objectContaining({ mentions: [] }) }),
      );
      expect(result.body).toBe("Hello world");
    });

    it("stores mentionUserIds as mentions when every id is a workspace member", async () => {
      prismaMock.issue.findFirst.mockResolvedValue({
        id: "issue_1",
        projectId: "proj_1",
        project: { workspaceId: "ws_1" },
      });
      prismaMock.workspaceMember.findMany.mockResolvedValue([
        { userId: "user_b" },
        { userId: "user_c" },
      ]);
      prismaMock.comment.create.mockImplementation(({ data }: any) =>
        Promise.resolve(baseCommentRow({ mentions: data.mentions })),
      );

      const result = await service.create("WF-1", "user_author", {
        body: "Hi @b @c",
        mentionUserIds: ["user_b", "user_c"],
      });

      expect(prismaMock.workspaceMember.findMany).toHaveBeenCalledWith({
        where: { workspaceId: "ws_1", userId: { in: ["user_b", "user_c"] } },
        select: { userId: true },
      });
      expect(result.mentions).toEqual(["user_b", "user_c"]);
      expect(eventsMock.emit).toHaveBeenCalledWith(
        "comment.added",
        expect.objectContaining({ projectId: "proj_1", issueKey: "WF-1", mentions: ["user_b", "user_c"] }),
      );
    });

    it("dedupes repeated mentionUserIds before storing/validating", async () => {
      prismaMock.issue.findFirst.mockResolvedValue({
        id: "issue_1",
        projectId: "proj_1",
        project: { workspaceId: "ws_1" },
      });
      prismaMock.workspaceMember.findMany.mockResolvedValue([{ userId: "user_b" }]);
      prismaMock.comment.create.mockImplementation(({ data }: any) =>
        Promise.resolve(baseCommentRow({ mentions: data.mentions })),
      );

      const result = await service.create("WF-1", "user_author", {
        body: "Hi @b",
        mentionUserIds: ["user_b", "user_b", "user_b"],
      });

      expect(prismaMock.workspaceMember.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ where: { workspaceId: "ws_1", userId: { in: ["user_b"] } } }),
      );
      expect(result.mentions).toEqual(["user_b"]);
    });

    it("400s listing offending ids when a mentioned user is not a workspace member", async () => {
      prismaMock.issue.findFirst.mockResolvedValue({
        id: "issue_1",
        projectId: "proj_1",
        project: { workspaceId: "ws_1" },
      });
      prismaMock.workspaceMember.findMany.mockResolvedValue([{ userId: "user_b" }]);

      await expect(
        service.create("WF-1", "user_author", {
          body: "Hi @outsider",
          mentionUserIds: ["user_b", "user_outsider"],
        }),
      ).rejects.toBeInstanceOf(BadRequestException);
      expect(prismaMock.comment.create).not.toHaveBeenCalled();

      try {
        await service.create("WF-1", "user_author", {
          body: "Hi @outsider",
          mentionUserIds: ["user_b", "user_outsider"],
        });
      } catch (err) {
        expect((err as BadRequestException).getResponse()).toEqual(
          expect.objectContaining({ offending: ["user_outsider"] }),
        );
      }
    });

    it("404s when the issue key doesn't resolve", async () => {
      prismaMock.issue.findFirst.mockResolvedValue(null);
      await expect(service.create("WF-999", "user_author", { body: "x" })).rejects.toBeInstanceOf(
        NotFoundException,
      );
    });
  });

  describe("update — author-only edit", () => {
    it("allows the author to edit their own comment", async () => {
      prismaMock.comment.findUnique.mockResolvedValue({
        authorId: "user_author",
        issue: { number: 1, project: { key: "WF", id: "proj_1", workspaceId: "ws_1" } },
      });
      prismaMock.comment.update.mockResolvedValue(baseCommentRow({ body: "Edited" }));

      const result = await service.update("comment_1", "user_author", { body: "Edited" });

      expect(prismaMock.comment.update).toHaveBeenCalledWith(
        expect.objectContaining({ where: { id: "comment_1" }, data: { body: "Edited" } }),
      );
      expect(result.body).toBe("Edited");
      expect(eventsMock.emit).toHaveBeenCalledWith(
        "comment.updated",
        expect.objectContaining({ projectId: "proj_1", issueKey: "WF-1" }),
      );
    });

    it("403s when a non-author tries to edit the comment", async () => {
      prismaMock.comment.findUnique.mockResolvedValue({
        authorId: "user_author",
        issue: { number: 1, project: { key: "WF", id: "proj_1", workspaceId: "ws_1" } },
      });

      await expect(
        service.update("comment_1", "user_other", { body: "Hijacked" }),
      ).rejects.toBeInstanceOf(ForbiddenException);
      expect(prismaMock.comment.update).not.toHaveBeenCalled();
    });

    it("re-validates and replaces mentions when mentionUserIds is provided", async () => {
      prismaMock.comment.findUnique.mockResolvedValue({
        authorId: "user_author",
        issue: { number: 1, project: { key: "WF", id: "proj_1", workspaceId: "ws_1" } },
      });
      prismaMock.workspaceMember.findMany.mockResolvedValue([{ userId: "user_b" }]);
      prismaMock.comment.update.mockImplementation(({ data }: any) =>
        Promise.resolve(baseCommentRow({ mentions: data.mentions })),
      );

      const result = await service.update("comment_1", "user_author", {
        body: "Edited",
        mentionUserIds: ["user_b"],
      });

      expect(prismaMock.comment.update).toHaveBeenCalledWith(
        expect.objectContaining({ data: { body: "Edited", mentions: ["user_b"] } }),
      );
      expect(result.mentions).toEqual(["user_b"]);
    });

    it("leaves existing mentions untouched when mentionUserIds is not provided", async () => {
      prismaMock.comment.findUnique.mockResolvedValue({
        authorId: "user_author",
        issue: { number: 1, project: { key: "WF", id: "proj_1", workspaceId: "ws_1" } },
      });
      prismaMock.comment.update.mockResolvedValue(baseCommentRow({ body: "Edited", mentions: ["user_b"] }));

      await service.update("comment_1", "user_author", { body: "Edited" });

      expect(prismaMock.workspaceMember.findMany).not.toHaveBeenCalled();
      expect(prismaMock.comment.update).toHaveBeenCalledWith(
        expect.objectContaining({ data: { body: "Edited" } }),
      );
    });

    it("404s when the comment doesn't exist", async () => {
      prismaMock.comment.findUnique.mockResolvedValue(null);
      await expect(service.update("ghost", "user_author", { body: "x" })).rejects.toBeInstanceOf(
        NotFoundException,
      );
    });
  });

  describe("remove — author/owner delete matrix", () => {
    const commentRef = {
      authorId: "user_author",
      issue: { number: 1, project: { key: "WF", id: "proj_1", workspaceId: "ws_1" } },
    };

    it("allows the author (a plain MEMBER) to delete their own comment", async () => {
      prismaMock.comment.findUnique.mockResolvedValue(commentRef);
      prismaMock.comment.delete.mockResolvedValue({});

      await service.remove("comment_1", "user_author", { workspaceId: "ws_1", role: "MEMBER" });

      expect(prismaMock.comment.delete).toHaveBeenCalledWith({ where: { id: "comment_1" } });
      expect(eventsMock.emit).toHaveBeenCalledWith("comment.deleted", {
        projectId: "proj_1",
        issueKey: "WF-1",
        commentId: "comment_1",
      });
    });

    it("allows a workspace OWNER to delete someone else's comment", async () => {
      prismaMock.comment.findUnique.mockResolvedValue(commentRef);
      prismaMock.comment.delete.mockResolvedValue({});

      await service.remove("comment_1", "user_owner", { workspaceId: "ws_1", role: "OWNER" });

      expect(prismaMock.comment.delete).toHaveBeenCalledWith({ where: { id: "comment_1" } });
    });

    it("403s a non-author, non-owner MEMBER trying to delete someone else's comment", async () => {
      prismaMock.comment.findUnique.mockResolvedValue(commentRef);

      await expect(
        service.remove("comment_1", "user_other", { workspaceId: "ws_1", role: "MEMBER" }),
      ).rejects.toBeInstanceOf(ForbiddenException);
      expect(prismaMock.comment.delete).not.toHaveBeenCalled();
    });

    it("404s when the comment doesn't exist", async () => {
      prismaMock.comment.findUnique.mockResolvedValue(null);
      await expect(
        service.remove("ghost", "user_author", { workspaceId: "ws_1", role: "OWNER" }),
      ).rejects.toBeInstanceOf(NotFoundException);
    });
  });

  describe("listByIssueKey", () => {
    it("returns comments oldest-first with author summary and a nextCursor when more rows exist", async () => {
      prismaMock.issue.findFirst.mockResolvedValue({
        id: "issue_1",
        projectId: "proj_1",
        project: { workspaceId: "ws_1" },
      });
      const rows = [
        baseCommentRow({ id: "c1" }),
        baseCommentRow({ id: "c2" }),
        baseCommentRow({ id: "c3" }),
      ];
      prismaMock.comment.findMany.mockResolvedValue(rows);

      const result = await service.listByIssueKey("WF-1", { limit: 2 });

      expect(prismaMock.comment.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ where: { issueId: "issue_1" }, orderBy: { createdAt: "asc" }, take: 3 }),
      );
      expect(result.items).toHaveLength(2);
      expect(result.items[0]!.author).toEqual({ id: "user_author", name: "Author Name", avatarUrl: null });
      expect(result.nextCursor).toBe("c2");
    });

    it("404s when the issue key doesn't resolve", async () => {
      prismaMock.issue.findFirst.mockResolvedValue(null);
      await expect(service.listByIssueKey("WF-999", { limit: 50 })).rejects.toBeInstanceOf(
        NotFoundException,
      );
    });
  });
});
