import { ForbiddenException, NotFoundException } from "@nestjs/common";
import { Test } from "@nestjs/testing";
import { NotificationsService } from "./notifications.service.js";
import { PrismaService } from "../prisma/prisma.service.js";

describe("NotificationsService", () => {
  let service: NotificationsService;

  const prismaMock = {
    notification: {
      findMany: jest.fn(),
      findUnique: jest.fn(),
      update: jest.fn(),
      updateMany: jest.fn(),
      count: jest.fn(),
    },
  };

  const baseRow = (overrides: Record<string, unknown> = {}) => ({
    id: "notif_1",
    userId: "user_1",
    type: "MENTION",
    payload: { issueKey: "WF-1", projectId: "proj_1", actorId: "user_2", actorName: "Actor" },
    readAt: null,
    createdAt: new Date(),
    ...overrides,
  });

  beforeEach(async () => {
    jest.resetAllMocks();

    const moduleRef = await Test.createTestingModule({
      providers: [NotificationsService, { provide: PrismaService, useValue: prismaMock }],
    }).compile();

    service = moduleRef.get(NotificationsService);
  });

  describe("listForUser", () => {
    it("lists the caller's own notifications newest-first with a nextCursor when more rows exist", async () => {
      const rows = [baseRow({ id: "n1" }), baseRow({ id: "n2" }), baseRow({ id: "n3" })];
      prismaMock.notification.findMany.mockResolvedValue(rows);

      const result = await service.listForUser("user_1", { limit: 2 });

      expect(prismaMock.notification.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ where: { userId: "user_1" }, orderBy: { createdAt: "desc" }, take: 3 }),
      );
      expect(result.items).toHaveLength(2);
      expect(result.nextCursor).toBe("n2");
    });

    it("returns a null nextCursor when there are no more rows", async () => {
      prismaMock.notification.findMany.mockResolvedValue([baseRow()]);
      const result = await service.listForUser("user_1", { limit: 25 });
      expect(result.nextCursor).toBeNull();
    });
  });

  describe("unreadCount", () => {
    it("counts only the caller's unread notifications", async () => {
      prismaMock.notification.count.mockResolvedValue(3);
      const count = await service.unreadCount("user_1");
      expect(prismaMock.notification.count).toHaveBeenCalledWith({
        where: { userId: "user_1", readAt: null },
      });
      expect(count).toBe(3);
    });
  });

  describe("markRead", () => {
    it("marks the caller's own notification read", async () => {
      prismaMock.notification.findUnique.mockResolvedValue(baseRow());
      prismaMock.notification.update.mockResolvedValue(baseRow({ readAt: new Date() }));

      const result = await service.markRead("notif_1", "user_1");

      expect(prismaMock.notification.update).toHaveBeenCalledWith(
        expect.objectContaining({ where: { id: "notif_1" } }),
      );
      expect(result.readAt).not.toBeNull();
    });

    it("403s when marking another user's notification read", async () => {
      prismaMock.notification.findUnique.mockResolvedValue(baseRow({ userId: "user_2" }));
      await expect(service.markRead("notif_1", "user_1")).rejects.toBeInstanceOf(ForbiddenException);
      expect(prismaMock.notification.update).not.toHaveBeenCalled();
    });

    it("404s when the notification doesn't exist", async () => {
      prismaMock.notification.findUnique.mockResolvedValue(null);
      await expect(service.markRead("ghost", "user_1")).rejects.toBeInstanceOf(NotFoundException);
    });
  });

  describe("markAllRead", () => {
    it("marks all of the caller's unread notifications as read and returns the count", async () => {
      prismaMock.notification.updateMany.mockResolvedValue({ count: 5 });

      const result = await service.markAllRead("user_1");

      expect(prismaMock.notification.updateMany).toHaveBeenCalledWith({
        where: { userId: "user_1", readAt: null },
        data: { readAt: expect.any(Date) },
      });
      expect(result).toEqual({ count: 5 });
    });
  });
});
