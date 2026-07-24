import { ForbiddenException, Injectable } from "@nestjs/common";
import type { CreateView, Role, UpdateView, View, ViewScope, WorkfloQuery } from "@workflo/shared";
import { PrismaService } from "../prisma/prisma.service.js";

type ViewRow = {
  id: string;
  workspaceId: string;
  creatorId: string;
  name: string;
  scope: string;
  ast: unknown;
  pinned: boolean;
  createdAt: Date;
  updatedAt: Date;
};

function toView(row: ViewRow): View {
  return {
    id: row.id,
    workspaceId: row.workspaceId,
    creatorId: row.creatorId,
    name: row.name,
    scope: row.scope as ViewScope,
    ast: row.ast as WorkfloQuery,
    pinned: row.pinned,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

/** The 3 seeded default views (docs/design/nlq-search.md §2.6) — created lazily the FIRST time a user lists views for a workspace. */
function seedDefaults(workspaceId: string, userId: string) {
  return [
    {
      workspaceId,
      creatorId: userId,
      name: "Assigned to me",
      scope: "PERSONAL" as const,
      ast: { v: 1, assignee: "me" } satisfies WorkfloQuery,
      pinned: false,
    },
    {
      workspaceId,
      creatorId: userId,
      name: "Reported by me",
      scope: "PERSONAL" as const,
      ast: { v: 1, reporter: "me" } satisfies WorkfloQuery,
      pinned: false,
    },
    {
      workspaceId,
      creatorId: userId,
      name: "Due this week",
      scope: "PERSONAL" as const,
      ast: { v: 1, due: { withinDays: 7 } } satisfies WorkfloQuery,
      pinned: false,
    },
  ];
}

/**
 * Saved Views (docs/design/nlq-search.md §2.6/§3.5). Unlike Notifications
 * (pure user-scoping), Views need WORKSPACE membership + role context: a
 * View belongs to a workspace, WORKSPACE-scope views are shared across
 * members, and editing one is OWNER-or-creator — so this service is always
 * called behind WorkspaceMemberGuard (see views.controller.ts), and
 * update/remove take the caller's resolved role explicitly.
 */
@Injectable()
export class ViewsService {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * Lists the views visible to `userId` in `workspaceId`: every WORKSPACE
   * view plus the caller's own PERSONAL views, pinned first then most
   * recently updated (the left-rail ordering, §2.6).
   *
   * Seeding: if this is the user's first-ever visit to this workspace (zero
   * PERSONAL views), the 3 defaults are created here, lazily, on the first
   * GET. A rare concurrent double-seed (two tabs opening simultaneously) is
   * accepted as harmless — a single client only ever fires one GET on
   * mount, and having 6 default rows instead of 3 doesn't corrupt anything.
   * Deliberately NOT guarded by a unique constraint for this.
   */
  async listForUser(workspaceId: string, userId: string): Promise<View[]> {
    const personalCount = await this.prisma.view.count({
      where: { workspaceId, creatorId: userId },
    });

    if (personalCount === 0) {
      await this.prisma.view.createMany({ data: seedDefaults(workspaceId, userId) });
    }

    const rows = await this.prisma.view.findMany({
      where: {
        workspaceId,
        OR: [{ scope: "WORKSPACE" }, { scope: "PERSONAL", creatorId: userId }],
      },
      orderBy: [{ pinned: "desc" }, { updatedAt: "desc" }],
    });

    return rows.map(toView);
  }

  async create(userId: string, dto: CreateView): Promise<View> {
    const row = await this.prisma.view.create({
      data: {
        creatorId: userId,
        workspaceId: dto.workspaceId,
        name: dto.name,
        ast: dto.ast,
        scope: dto.scope,
        pinned: dto.pinned,
      },
    });
    return toView(row);
  }

  async update(id: string, userId: string, role: Role, dto: UpdateView): Promise<View> {
    const existing = await this.prisma.view.findUnique({ where: { id } });
    this.assertCanEdit(existing, userId, role);

    const row = await this.prisma.view.update({
      where: { id },
      data: {
        ...(dto.name !== undefined ? { name: dto.name } : {}),
        ...(dto.ast !== undefined ? { ast: dto.ast } : {}),
        ...(dto.scope !== undefined ? { scope: dto.scope } : {}),
        ...(dto.pinned !== undefined ? { pinned: dto.pinned } : {}),
      },
    });
    return toView(row);
  }

  async remove(id: string, userId: string, role: Role): Promise<View> {
    const existing = await this.prisma.view.findUnique({ where: { id } });
    this.assertCanEdit(existing, userId, role);

    const row = await this.prisma.view.delete({ where: { id } });
    return toView(row);
  }

  /**
   * PERSONAL: creator-only. WORKSPACE: creator OR workspace OWNER. The
   * guard has already 404'd an unknown id and confirmed workspace
   * membership before this is called, so `existing` here is only ever null
   * in a benign race (deleted between the guard's lookup and this one) —
   * treated as Forbidden rather than a fresh 404 to keep this one check
   * simple (the caller already knows the id existed a moment ago).
   */
  private assertCanEdit(existing: ViewRow | null, userId: string, role: Role): asserts existing is ViewRow {
    if (!existing) {
      throw new ForbiddenException("View not found");
    }
    if (existing.scope === "PERSONAL") {
      if (existing.creatorId !== userId) {
        throw new ForbiddenException("Only the creator can edit a personal view");
      }
      return;
    }
    // WORKSPACE
    if (existing.creatorId !== userId && role !== "OWNER") {
      throw new ForbiddenException("Only the creator or a workspace owner can edit this view");
    }
  }
}
