import { BadRequestException, ConflictException, NotFoundException } from "@nestjs/common";
import { Test } from "@nestjs/testing";
import { WorkspacesService } from "./workspaces.service.js";
import { PrismaService } from "../prisma/prisma.service.js";

/**
 * Unit tests for WorkspacesService with a fully mocked Prisma layer,
 * matching the style of auth.service.spec.ts.
 */
describe("WorkspacesService", () => {
  let service: WorkspacesService;

  const prismaMock = {
    workspace: {
      findUnique: jest.fn(),
      findMany: jest.fn(),
      create: jest.fn(),
      update: jest.fn(),
      delete: jest.fn(),
    },
    workspaceMember: {
      findUnique: jest.fn(),
      findMany: jest.fn(),
      create: jest.fn(),
      update: jest.fn(),
      delete: jest.fn(),
      count: jest.fn(),
    },
    user: {
      findUnique: jest.fn(),
    },
    $transaction: jest.fn(),
  };

  beforeEach(async () => {
    jest.clearAllMocks();

    const moduleRef = await Test.createTestingModule({
      providers: [WorkspacesService, { provide: PrismaService, useValue: prismaMock }],
    }).compile();

    service = moduleRef.get(WorkspacesService);
  });

  describe("create", () => {
    it("creates a workspace and makes the creator an OWNER member in one transaction", async () => {
      prismaMock.workspace.findUnique.mockResolvedValue(null); // slug is free

      const txWorkspace = { id: "ws_1", name: "Acme", slug: "acme", createdAt: new Date() };
      const txCreateWorkspace = jest.fn().mockResolvedValue(txWorkspace);
      const txCreateMember = jest.fn().mockResolvedValue({});

      prismaMock.$transaction.mockImplementation(async (fn: any) =>
        fn({
          workspace: { create: txCreateWorkspace },
          workspaceMember: { create: txCreateMember },
        }),
      );

      const result = await service.create("user_1", { name: "Acme" });

      expect(txCreateWorkspace).toHaveBeenCalledWith({ data: { name: "Acme", slug: "acme" } });
      expect(txCreateMember).toHaveBeenCalledWith({
        data: { workspaceId: "ws_1", userId: "user_1", role: "OWNER" },
      });
      expect(result).toEqual({ id: "ws_1", name: "Acme", slug: "acme", createdAt: txWorkspace.createdAt });
    });

    it("derives a unique slug by suffixing when the base slug is taken", async () => {
      // First check ("acme") taken, second ("acme-2") free.
      prismaMock.workspace.findUnique
        .mockResolvedValueOnce({ id: "existing", slug: "acme" })
        .mockResolvedValueOnce(null);

      const txCreateWorkspace = jest.fn().mockResolvedValue({
        id: "ws_2",
        name: "Acme",
        slug: "acme-2",
        createdAt: new Date(),
      });
      prismaMock.$transaction.mockImplementation(async (fn: any) =>
        fn({
          workspace: { create: txCreateWorkspace },
          workspaceMember: { create: jest.fn().mockResolvedValue({}) },
        }),
      );

      await service.create("user_1", { name: "Acme" });

      expect(txCreateWorkspace).toHaveBeenCalledWith({ data: { name: "Acme", slug: "acme-2" } });
    });
  });

  describe("addMember", () => {
    it("rejects with 404 when no user has that email", async () => {
      prismaMock.user.findUnique.mockResolvedValue(null);

      await expect(
        service.addMember("ws_1", { email: "nobody@example.com", role: "MEMBER" }),
      ).rejects.toBeInstanceOf(NotFoundException);
    });

    it("rejects with 409 when the user is already a member", async () => {
      prismaMock.user.findUnique.mockResolvedValue({
        id: "user_2",
        email: "b@example.com",
        name: "B",
        avatarUrl: null,
      });
      prismaMock.workspaceMember.findUnique.mockResolvedValue({
        workspaceId: "ws_1",
        userId: "user_2",
        role: "MEMBER",
      });

      await expect(
        service.addMember("ws_1", { email: "b@example.com", role: "MEMBER" }),
      ).rejects.toBeInstanceOf(ConflictException);
      expect(prismaMock.workspaceMember.create).not.toHaveBeenCalled();
    });

    it("adds the member when the user exists and isn't already a member", async () => {
      prismaMock.user.findUnique.mockResolvedValue({
        id: "user_2",
        email: "b@example.com",
        name: "B",
        avatarUrl: null,
      });
      prismaMock.workspaceMember.findUnique.mockResolvedValue(null);
      prismaMock.workspaceMember.create.mockResolvedValue({
        workspaceId: "ws_1",
        userId: "user_2",
        role: "MEMBER",
        user: { id: "user_2", email: "b@example.com", name: "B", avatarUrl: null },
      });

      const result = await service.addMember("ws_1", { email: "b@example.com", role: "MEMBER" });
      expect(result.role).toBe("MEMBER");
      expect(result.user.email).toBe("b@example.com");
    });
  });

  describe("last-owner protection", () => {
    it("blocks demoting the last OWNER to MEMBER", async () => {
      prismaMock.workspaceMember.findUnique.mockResolvedValue({
        workspaceId: "ws_1",
        userId: "user_1",
        role: "OWNER",
      });
      prismaMock.workspaceMember.count.mockResolvedValue(1);

      await expect(
        service.updateMemberRole("ws_1", "user_1", { role: "MEMBER" }),
      ).rejects.toBeInstanceOf(BadRequestException);
      expect(prismaMock.workspaceMember.update).not.toHaveBeenCalled();
    });

    it("allows demoting an OWNER when another OWNER remains", async () => {
      prismaMock.workspaceMember.findUnique.mockResolvedValue({
        workspaceId: "ws_1",
        userId: "user_1",
        role: "OWNER",
      });
      prismaMock.workspaceMember.count.mockResolvedValue(2);
      prismaMock.workspaceMember.update.mockResolvedValue({
        workspaceId: "ws_1",
        userId: "user_1",
        role: "MEMBER",
        user: { id: "user_1", email: "a@example.com", name: "A", avatarUrl: null },
      });

      const result = await service.updateMemberRole("ws_1", "user_1", { role: "MEMBER" });
      expect(result.role).toBe("MEMBER");
    });

    it("blocks removing the last OWNER", async () => {
      prismaMock.workspaceMember.findUnique.mockResolvedValue({
        workspaceId: "ws_1",
        userId: "user_1",
        role: "OWNER",
      });
      prismaMock.workspaceMember.count.mockResolvedValue(1);

      await expect(service.removeMember("ws_1", "user_1")).rejects.toBeInstanceOf(BadRequestException);
      expect(prismaMock.workspaceMember.delete).not.toHaveBeenCalled();
    });

    it("allows removing a non-owner member regardless of owner count", async () => {
      prismaMock.workspaceMember.findUnique.mockResolvedValue({
        workspaceId: "ws_1",
        userId: "user_2",
        role: "MEMBER",
      });
      prismaMock.workspaceMember.delete.mockResolvedValue({});

      await service.removeMember("ws_1", "user_2");
      expect(prismaMock.workspaceMember.count).not.toHaveBeenCalled();
      expect(prismaMock.workspaceMember.delete).toHaveBeenCalledWith({
        where: { workspaceId_userId: { workspaceId: "ws_1", userId: "user_2" } },
      });
    });
  });
});
