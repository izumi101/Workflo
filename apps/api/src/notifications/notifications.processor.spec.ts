import { Test } from "@nestjs/testing";
import { NotificationsProcessor } from "./notifications.processor.js";
import { PrismaService } from "../prisma/prisma.service.js";
import { RealtimeGateway } from "../realtime/realtime.gateway.js";

describe("NotificationsProcessor", () => {
  let processor: NotificationsProcessor;

  const prismaMock = {
    user: { findUnique: jest.fn() },
    notification: { create: jest.fn() },
  };

  const emitMock = jest.fn();
  const gatewayMock = {
    server: { to: jest.fn() },
  };

  beforeEach(async () => {
    jest.resetAllMocks();
    gatewayMock.server.to.mockReturnValue({ emit: emitMock });

    const moduleRef = await Test.createTestingModule({
      providers: [
        NotificationsProcessor,
        { provide: PrismaService, useValue: prismaMock },
        { provide: RealtimeGateway, useValue: gatewayMock },
      ],
    }).compile();

    processor = moduleRef.get(NotificationsProcessor);
  });

  const job = (data: Record<string, unknown>) => ({ data }) as any;

  it("creates a Notification row with the job's userId/type/payload for a MENTION job", async () => {
    prismaMock.user.findUnique.mockResolvedValue({ name: "Alice Actor" });
    prismaMock.notification.create.mockResolvedValue({
      id: "notif_1",
      userId: "user_b",
      type: "MENTION",
      payload: {
        issueKey: "WF-1",
        projectId: "proj_1",
        actorId: "user_a",
        actorName: "Alice Actor",
        commentId: "comment_1",
        snippet: "hey @b",
      },
      readAt: null,
      createdAt: new Date(),
    });

    await processor.process(
      job({
        userId: "user_b",
        type: "MENTION",
        actorId: "user_a",
        issueKey: "WF-1",
        projectId: "proj_1",
        commentId: "comment_1",
        snippet: "hey @b",
      }),
    );

    expect(prismaMock.notification.create).toHaveBeenCalledWith({
      data: {
        userId: "user_b",
        type: "MENTION",
        payload: expect.objectContaining({
          issueKey: "WF-1",
          projectId: "proj_1",
          actorId: "user_a",
          actorName: "Alice Actor",
          commentId: "comment_1",
          snippet: "hey @b",
        }),
      },
    });
  });

  it("creates a Notification row for an ASSIGNED job (no commentId/snippet)", async () => {
    prismaMock.user.findUnique.mockResolvedValue({ name: "Bob Actor" });
    prismaMock.notification.create.mockResolvedValue({
      id: "notif_2",
      userId: "user_c",
      type: "ASSIGNED",
      payload: { issueKey: "WF-2", projectId: "proj_1", actorId: "user_b", actorName: "Bob Actor" },
      readAt: null,
      createdAt: new Date(),
    });

    await processor.process(
      job({ userId: "user_c", type: "ASSIGNED", actorId: "user_b", issueKey: "WF-2", projectId: "proj_1" }),
    );

    expect(prismaMock.notification.create).toHaveBeenCalledWith({
      data: {
        userId: "user_c",
        type: "ASSIGNED",
        payload: expect.objectContaining({
          issueKey: "WF-2",
          projectId: "proj_1",
          actorId: "user_b",
          actorName: "Bob Actor",
        }),
      },
    });
    const call = prismaMock.notification.create.mock.calls[0][0];
    expect(call.data.payload.commentId).toBeUndefined();
    expect(call.data.payload.snippet).toBeUndefined();
  });

  it("falls back to a generic actor name when the actor user can't be found", async () => {
    prismaMock.user.findUnique.mockResolvedValue(null);
    prismaMock.notification.create.mockResolvedValue({
      id: "notif_3",
      userId: "user_c",
      type: "ASSIGNED",
      payload: { issueKey: "WF-2", projectId: "proj_1", actorId: "ghost", actorName: "Someone" },
      readAt: null,
      createdAt: new Date(),
    });

    await processor.process(
      job({ userId: "user_c", type: "ASSIGNED", actorId: "ghost", issueKey: "WF-2", projectId: "proj_1" }),
    );

    expect(prismaMock.notification.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ payload: expect.objectContaining({ actorName: "Someone" }) }),
      }),
    );
  });

  it("emits notification.created to the target user's room with the created row", async () => {
    prismaMock.user.findUnique.mockResolvedValue({ name: "Alice Actor" });
    const createdRow = {
      id: "notif_1",
      userId: "user_b",
      type: "MENTION",
      payload: { issueKey: "WF-1", projectId: "proj_1", actorId: "user_a", actorName: "Alice Actor" },
      readAt: null,
      createdAt: new Date(),
    };
    prismaMock.notification.create.mockResolvedValue(createdRow);

    await processor.process(
      job({ userId: "user_b", type: "MENTION", actorId: "user_a", issueKey: "WF-1", projectId: "proj_1" }),
    );

    expect(gatewayMock.server.to).toHaveBeenCalledWith("user:user_b");
    expect(emitMock).toHaveBeenCalledWith(
      "notification.created",
      expect.objectContaining({ id: "notif_1", userId: "user_b", type: "MENTION" }),
    );
  });
});
