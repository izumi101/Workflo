import { Test } from "@nestjs/testing";
import type { Issue, IssueDeletedEventPayload } from "@workflo/shared";
import { TriageCacheListener } from "./triage-cache.listener.js";
import { TriageCacheService } from "./triage-cache.service.js";
import { PrismaService } from "../prisma/prisma.service.js";

function makeIssue(overrides: Partial<Issue> = {}): Issue {
  return {
    id: "issue_1",
    projectId: "proj_1",
    number: 1,
    title: "Some issue",
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
    labelIds: [],
    ...overrides,
  } as Issue;
}

describe("TriageCacheListener", () => {
  let listener: TriageCacheListener;

  const prismaMock = {
    project: {
      findUnique: jest.fn(),
    },
  };

  const cacheMock = {
    delByWorkspace: jest.fn(),
  };

  beforeEach(async () => {
    jest.resetAllMocks();
    prismaMock.project.findUnique.mockResolvedValue({ workspaceId: "ws_1" });
    cacheMock.delByWorkspace.mockResolvedValue(undefined);

    const moduleRef = await Test.createTestingModule({
      providers: [
        TriageCacheListener,
        { provide: PrismaService, useValue: prismaMock },
        { provide: TriageCacheService, useValue: cacheMock },
      ],
    }).compile();

    listener = moduleRef.get(TriageCacheListener);
  });

  it("onIssueCreated resolves the project's workspaceId and invalidates that workspace's cache", async () => {
    await listener.onIssueCreated(makeIssue({ projectId: "proj_1" }));

    expect(prismaMock.project.findUnique).toHaveBeenCalledWith({
      where: { id: "proj_1" },
      select: { workspaceId: true },
    });
    expect(cacheMock.delByWorkspace).toHaveBeenCalledWith("ws_1");
  });

  it("onIssueUpdated resolves the project's workspaceId and invalidates that workspace's cache", async () => {
    await listener.onIssueUpdated(makeIssue({ projectId: "proj_2" }));

    expect(prismaMock.project.findUnique).toHaveBeenCalledWith({
      where: { id: "proj_2" },
      select: { workspaceId: true },
    });
    expect(cacheMock.delByWorkspace).toHaveBeenCalledWith("ws_1");
  });

  it("onIssueMoved resolves the project's workspaceId and invalidates that workspace's cache", async () => {
    await listener.onIssueMoved(makeIssue({ projectId: "proj_3" }));

    expect(prismaMock.project.findUnique).toHaveBeenCalledWith({
      where: { id: "proj_3" },
      select: { workspaceId: true },
    });
    expect(cacheMock.delByWorkspace).toHaveBeenCalledWith("ws_1");
  });

  it("onIssueDeleted resolves the project's workspaceId (from the payload, not an Issue) and invalidates that workspace's cache", async () => {
    const payload: IssueDeletedEventPayload = { projectId: "proj_4", issueId: "issue_9" };

    await listener.onIssueDeleted(payload);

    expect(prismaMock.project.findUnique).toHaveBeenCalledWith({
      where: { id: "proj_4" },
      select: { workspaceId: true },
    });
    expect(cacheMock.delByWorkspace).toHaveBeenCalledWith("ws_1");
  });

  it("does NOT throw when the project lookup rejects", async () => {
    prismaMock.project.findUnique.mockRejectedValue(new Error("db down"));

    await expect(listener.onIssueCreated(makeIssue())).resolves.toBeUndefined();
    expect(cacheMock.delByWorkspace).not.toHaveBeenCalled();
  });

  it("does NOT throw when delByWorkspace rejects", async () => {
    cacheMock.delByWorkspace.mockRejectedValue(new Error("redis down"));

    await expect(listener.onIssueCreated(makeIssue())).resolves.toBeUndefined();
  });

  it("is a no-op (no cache call) when the project no longer exists (benign race)", async () => {
    prismaMock.project.findUnique.mockResolvedValue(null);

    await listener.onIssueDeleted({ projectId: "ghost_project", issueId: "issue_1" });

    expect(cacheMock.delByWorkspace).not.toHaveBeenCalled();
  });
});
