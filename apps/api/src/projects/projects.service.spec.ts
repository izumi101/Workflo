import { ConflictException, NotFoundException } from "@nestjs/common";
import { Test } from "@nestjs/testing";
import { ProjectsService } from "./projects.service.js";
import { PrismaService } from "../prisma/prisma.service.js";

describe("ProjectsService", () => {
  let service: ProjectsService;

  const prismaMock = {
    project: {
      findUnique: jest.fn(),
      findMany: jest.fn(),
      create: jest.fn(),
      update: jest.fn(),
      delete: jest.fn(),
    },
  };

  beforeEach(async () => {
    jest.clearAllMocks();

    const moduleRef = await Test.createTestingModule({
      providers: [ProjectsService, { provide: PrismaService, useValue: prismaMock }],
    }).compile();

    service = moduleRef.get(ProjectsService);
  });

  describe("create", () => {
    it("creates a project when the key is free in the workspace", async () => {
      prismaMock.project.findUnique.mockResolvedValue(null);
      prismaMock.project.create.mockResolvedValue({
        id: "proj_1",
        workspaceId: "ws_1",
        key: "WF",
        name: "Workflo",
        createdAt: new Date(),
      });

      const result = await service.create({ workspaceId: "ws_1", key: "WF", name: "Workflo" });

      expect(prismaMock.project.findUnique).toHaveBeenCalledWith({
        where: { workspaceId_key: { workspaceId: "ws_1", key: "WF" } },
      });
      expect(result.key).toBe("WF");
    });

    it("rejects with 409 when the key already exists in the workspace", async () => {
      prismaMock.project.findUnique.mockResolvedValue({
        id: "proj_existing",
        workspaceId: "ws_1",
        key: "WF",
        name: "Workflo",
        createdAt: new Date(),
      });

      await expect(
        service.create({ workspaceId: "ws_1", key: "WF", name: "Workflo Dup" }),
      ).rejects.toBeInstanceOf(ConflictException);
      expect(prismaMock.project.create).not.toHaveBeenCalled();
    });
  });

  describe("getById", () => {
    it("throws 404 when the project doesn't exist", async () => {
      prismaMock.project.findUnique.mockResolvedValue(null);
      await expect(service.getById("ghost")).rejects.toBeInstanceOf(NotFoundException);
    });
  });

  describe("listByWorkspace", () => {
    it("returns projects scoped to the workspace, ordered by createdAt", async () => {
      prismaMock.project.findMany.mockResolvedValue([
        { id: "p1", workspaceId: "ws_1", key: "WF", name: "Workflo", createdAt: new Date() },
      ]);

      const result = await service.listByWorkspace("ws_1");

      expect(prismaMock.project.findMany).toHaveBeenCalledWith({
        where: { workspaceId: "ws_1" },
        orderBy: { createdAt: "asc" },
      });
      expect(result).toHaveLength(1);
    });
  });

  describe("update", () => {
    it("updates the project name", async () => {
      prismaMock.project.update.mockResolvedValue({
        id: "proj_1",
        workspaceId: "ws_1",
        key: "WF",
        name: "New Name",
        createdAt: new Date(),
      });

      const result = await service.update("proj_1", { name: "New Name" });
      expect(result.name).toBe("New Name");
    });
  });

  describe("remove", () => {
    it("deletes the project by id", async () => {
      prismaMock.project.delete.mockResolvedValue({});
      await service.remove("proj_1");
      expect(prismaMock.project.delete).toHaveBeenCalledWith({ where: { id: "proj_1" } });
    });
  });
});
