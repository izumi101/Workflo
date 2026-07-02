import { ConflictException, NotFoundException } from "@nestjs/common";
import { Test } from "@nestjs/testing";
import { LabelsService } from "./labels.service.js";
import { PrismaService } from "../prisma/prisma.service.js";

describe("LabelsService", () => {
  let service: LabelsService;

  const prismaMock = {
    label: {
      findUnique: jest.fn(),
      findMany: jest.fn(),
      create: jest.fn(),
      delete: jest.fn(),
    },
  };

  beforeEach(async () => {
    jest.clearAllMocks();

    const moduleRef = await Test.createTestingModule({
      providers: [LabelsService, { provide: PrismaService, useValue: prismaMock }],
    }).compile();

    service = moduleRef.get(LabelsService);
  });

  describe("create", () => {
    it("creates a label when the name is free in the project", async () => {
      prismaMock.label.findUnique.mockResolvedValue(null);
      prismaMock.label.create.mockResolvedValue({
        id: "label_1",
        projectId: "proj_1",
        name: "bug",
        color: "#ff0000",
      });

      const result = await service.create("proj_1", { name: "bug", color: "#ff0000" });

      expect(prismaMock.label.findUnique).toHaveBeenCalledWith({
        where: { projectId_name: { projectId: "proj_1", name: "bug" } },
      });
      expect(result.name).toBe("bug");
    });

    it("rejects with 409 when the label name already exists in the project", async () => {
      prismaMock.label.findUnique.mockResolvedValue({
        id: "label_existing",
        projectId: "proj_1",
        name: "bug",
        color: "#ff0000",
      });

      await expect(
        service.create("proj_1", { name: "bug", color: "#00ff00" }),
      ).rejects.toBeInstanceOf(ConflictException);
      expect(prismaMock.label.create).not.toHaveBeenCalled();
    });
  });

  describe("listByProject", () => {
    it("returns labels scoped to the project, ordered by name", async () => {
      prismaMock.label.findMany.mockResolvedValue([
        { id: "l1", projectId: "proj_1", name: "bug", color: "#ff0000" },
      ]);

      const result = await service.listByProject("proj_1");

      expect(prismaMock.label.findMany).toHaveBeenCalledWith({
        where: { projectId: "proj_1" },
        orderBy: { name: "asc" },
      });
      expect(result).toHaveLength(1);
    });
  });

  describe("remove", () => {
    it("deletes the label by id", async () => {
      prismaMock.label.findUnique.mockResolvedValue({
        id: "label_1",
        projectId: "proj_1",
        name: "bug",
        color: "#ff0000",
      });
      prismaMock.label.delete.mockResolvedValue({});

      await service.remove("label_1");

      expect(prismaMock.label.delete).toHaveBeenCalledWith({ where: { id: "label_1" } });
    });

    it("throws 404 when the label doesn't exist", async () => {
      prismaMock.label.findUnique.mockResolvedValue(null);
      await expect(service.remove("ghost")).rejects.toBeInstanceOf(NotFoundException);
      expect(prismaMock.label.delete).not.toHaveBeenCalled();
    });
  });
});
