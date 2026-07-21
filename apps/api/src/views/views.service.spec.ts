import { ForbiddenException } from "@nestjs/common";
import { Test } from "@nestjs/testing";
import { ViewsService } from "./views.service.js";
import { PrismaService } from "../prisma/prisma.service.js";

describe("ViewsService", () => {
  let service: ViewsService;

  const prismaMock = {
    view: {
      count: jest.fn(),
      createMany: jest.fn(),
      findMany: jest.fn(),
      findUnique: jest.fn(),
      create: jest.fn(),
      update: jest.fn(),
      delete: jest.fn(),
    },
  };

  const baseRow = (overrides: Record<string, unknown> = {}) => ({
    id: "view_1",
    workspaceId: "ws_1",
    creatorId: "user_1",
    name: "Assigned to me",
    scope: "PERSONAL",
    ast: { v: 1, assignee: "me" },
    pinned: false,
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  });

  beforeEach(async () => {
    jest.resetAllMocks();

    const moduleRef = await Test.createTestingModule({
      providers: [ViewsService, { provide: PrismaService, useValue: prismaMock }],
    }).compile();

    service = moduleRef.get(ViewsService);
  });

  describe("listForUser", () => {
    it("returns the caller's PERSONAL views plus every WORKSPACE view, pinned first then most recent", async () => {
      prismaMock.view.count.mockResolvedValue(2); // caller already has personal views -> no seeding
      const rows = [
        baseRow({ id: "v_pinned", pinned: true }),
        baseRow({ id: "v_recent", scope: "WORKSPACE" }),
      ];
      prismaMock.view.findMany.mockResolvedValue(rows);

      const result = await service.listForUser("ws_1", "user_1");

      expect(prismaMock.view.createMany).not.toHaveBeenCalled();
      expect(prismaMock.view.findMany).toHaveBeenCalledWith({
        where: {
          workspaceId: "ws_1",
          OR: [{ scope: "WORKSPACE" }, { scope: "PERSONAL", creatorId: "user_1" }],
        },
        orderBy: [{ pinned: "desc" }, { updatedAt: "desc" }],
      });
      expect(result).toHaveLength(2);
      expect(result[0]!.id).toBe("v_pinned");
    });

    it("seeds the 3 default views (createMany) only when the caller has zero PERSONAL views yet", async () => {
      prismaMock.view.count.mockResolvedValue(0);
      prismaMock.view.findMany.mockResolvedValue([
        baseRow({ id: "d1", name: "Assigned to me" }),
        baseRow({ id: "d2", name: "Reported by me" }),
        baseRow({ id: "d3", name: "Due this week" }),
      ]);

      await service.listForUser("ws_1", "user_1");

      expect(prismaMock.view.createMany).toHaveBeenCalledTimes(1);
      const { data } = prismaMock.view.createMany.mock.calls[0]![0];
      expect(data).toHaveLength(3);
      expect(data.map((d: any) => d.name)).toEqual(["Assigned to me", "Reported by me", "Due this week"]);
      expect(data.every((d: any) => d.workspaceId === "ws_1" && d.creatorId === "user_1")).toBe(true);
      expect(data.every((d: any) => d.scope === "PERSONAL" && d.pinned === false)).toBe(true);
      expect(data[0].ast).toEqual({ v: 1, assignee: "me" });
      expect(data[1].ast).toEqual({ v: 1, reporter: "me" });
      expect(data[2].ast).toEqual({ v: 1, due: { withinDays: 7 } });
    });

    it("does NOT re-seed when the user already has personal views", async () => {
      prismaMock.view.count.mockResolvedValue(1);
      prismaMock.view.findMany.mockResolvedValue([baseRow()]);

      await service.listForUser("ws_1", "user_1");

      expect(prismaMock.view.createMany).not.toHaveBeenCalled();
    });
  });

  describe("create", () => {
    it("sets creatorId from the caller, not the request body", async () => {
      prismaMock.view.create.mockResolvedValue(baseRow({ id: "new_view" }));

      const result = await service.create("user_1", {
        workspaceId: "ws_1",
        name: "My view",
        ast: { v: 1 },
        scope: "PERSONAL",
        pinned: false,
      });

      expect(prismaMock.view.create).toHaveBeenCalledWith({
        data: {
          creatorId: "user_1",
          workspaceId: "ws_1",
          name: "My view",
          ast: { v: 1 },
          scope: "PERSONAL",
          pinned: false,
        },
      });
      expect(result.id).toBe("new_view");
    });
  });

  describe("update/remove permission matrix", () => {
    it("allows the creator to edit their own PERSONAL view", async () => {
      prismaMock.view.findUnique.mockResolvedValue(baseRow({ scope: "PERSONAL", creatorId: "user_1" }));
      prismaMock.view.update.mockResolvedValue(baseRow({ name: "Renamed" }));

      await expect(service.update("view_1", "user_1", "MEMBER", { name: "Renamed" })).resolves.toBeDefined();
      expect(prismaMock.view.update).toHaveBeenCalledWith({
        where: { id: "view_1" },
        data: { name: "Renamed" },
      });
    });

    it("forbids a non-creator from editing a PERSONAL view (even if they're the workspace OWNER)", async () => {
      prismaMock.view.findUnique.mockResolvedValue(baseRow({ scope: "PERSONAL", creatorId: "user_1" }));

      await expect(service.update("view_1", "user_2", "OWNER", { name: "x" })).rejects.toBeInstanceOf(
        ForbiddenException,
      );
      expect(prismaMock.view.update).not.toHaveBeenCalled();
    });

    it("allows the creator to edit their own WORKSPACE view", async () => {
      prismaMock.view.findUnique.mockResolvedValue(baseRow({ scope: "WORKSPACE", creatorId: "user_1" }));
      prismaMock.view.update.mockResolvedValue(baseRow({ scope: "WORKSPACE", pinned: true }));

      await expect(service.update("view_1", "user_1", "MEMBER", { pinned: true })).resolves.toBeDefined();
    });

    it("allows a workspace OWNER who is NOT the creator to edit a WORKSPACE view", async () => {
      prismaMock.view.findUnique.mockResolvedValue(baseRow({ scope: "WORKSPACE", creatorId: "user_1" }));
      prismaMock.view.update.mockResolvedValue(baseRow({ scope: "WORKSPACE", pinned: true }));

      await expect(service.update("view_1", "user_owner", "OWNER", { pinned: true })).resolves.toBeDefined();
    });

    it("forbids a non-creator, non-owner MEMBER from editing a WORKSPACE view", async () => {
      prismaMock.view.findUnique.mockResolvedValue(baseRow({ scope: "WORKSPACE", creatorId: "user_1" }));

      await expect(service.update("view_1", "user_2", "MEMBER", { pinned: true })).rejects.toBeInstanceOf(
        ForbiddenException,
      );
      expect(prismaMock.view.update).not.toHaveBeenCalled();
    });

    it("applies the same matrix to remove()", async () => {
      prismaMock.view.findUnique.mockResolvedValue(baseRow({ scope: "WORKSPACE", creatorId: "user_1" }));
      prismaMock.view.delete.mockResolvedValue(baseRow());

      await expect(service.remove("view_1", "user_2", "MEMBER")).rejects.toBeInstanceOf(ForbiddenException);
      expect(prismaMock.view.delete).not.toHaveBeenCalled();

      await expect(service.remove("view_1", "user_1", "MEMBER")).resolves.toBeDefined();
      expect(prismaMock.view.delete).toHaveBeenCalledWith({ where: { id: "view_1" } });
    });
  });
});
