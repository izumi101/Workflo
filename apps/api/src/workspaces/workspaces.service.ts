import { BadRequestException, ConflictException, Injectable, NotFoundException } from "@nestjs/common";
import type {
  AddMember,
  CreateWorkspace,
  UpdateMemberRole,
  UpdateWorkspace,
  Workspace,
  WorkspaceMember,
} from "@workflo/shared";
import { PrismaService } from "../prisma/prisma.service.js";

function toWorkspace(workspace: { id: string; name: string; slug: string; createdAt: Date }): Workspace {
  return {
    id: workspace.id,
    name: workspace.name,
    slug: workspace.slug,
    createdAt: workspace.createdAt,
  };
}

function toWorkspaceMember(member: {
  userId: string;
  workspaceId: string;
  role: "OWNER" | "MEMBER";
  user: { id: string; email: string; name: string; avatarUrl: string | null };
}): WorkspaceMember {
  return {
    userId: member.userId,
    workspaceId: member.workspaceId,
    role: member.role,
    user: member.user,
  };
}

function slugify(name: string): string {
  const base = name
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/(^-|-$)/g, "");
  return base.length > 0 ? base : "workspace";
}

const USER_SELECT = { id: true, email: true, name: true, avatarUrl: true } as const;

@Injectable()
export class WorkspacesService {
  constructor(private readonly prisma: PrismaService) {}

  /** Creates a workspace with a unique slug and makes the creator its OWNER, atomically. */
  async create(userId: string, input: CreateWorkspace): Promise<Workspace> {
    const slug = await this.uniqueSlug(input.name);

    const workspace = await this.prisma.$transaction(async (tx) => {
      const created = await tx.workspace.create({
        data: { name: input.name, slug },
      });
      await tx.workspaceMember.create({
        data: { workspaceId: created.id, userId, role: "OWNER" },
      });
      return created;
    });

    return toWorkspace(workspace);
  }

  private async uniqueSlug(name: string): Promise<string> {
    const base = slugify(name);
    let candidate = base;
    let suffix = 1;
    // Small workspaces/low contention — a loop is fine; unique constraint on
    // slug is the real backstop against races.
    while (await this.prisma.workspace.findUnique({ where: { slug: candidate } })) {
      suffix += 1;
      candidate = `${base}-${suffix}`;
    }
    return candidate;
  }

  /** Lists workspaces the given user is a member of. */
  async listForUser(userId: string): Promise<Workspace[]> {
    const memberships = await this.prisma.workspaceMember.findMany({
      where: { userId },
      include: { workspace: true },
      orderBy: { workspace: { createdAt: "asc" } },
    });
    return memberships.map((m) => toWorkspace(m.workspace));
  }

  async getById(workspaceId: string): Promise<Workspace> {
    const workspace = await this.prisma.workspace.findUnique({ where: { id: workspaceId } });
    if (!workspace) {
      throw new NotFoundException("Workspace not found");
    }
    return toWorkspace(workspace);
  }

  async update(workspaceId: string, input: UpdateWorkspace): Promise<Workspace> {
    const workspace = await this.prisma.workspace.update({
      where: { id: workspaceId },
      data: { name: input.name },
    });
    return toWorkspace(workspace);
  }

  async remove(workspaceId: string): Promise<void> {
    await this.prisma.workspace.delete({ where: { id: workspaceId } });
  }

  async listMembers(workspaceId: string): Promise<WorkspaceMember[]> {
    const members = await this.prisma.workspaceMember.findMany({
      where: { workspaceId },
      include: { user: { select: USER_SELECT } },
      orderBy: { role: "asc" },
    });
    return members.map(toWorkspaceMember);
  }

  async addMember(workspaceId: string, input: AddMember): Promise<WorkspaceMember> {
    const user = await this.prisma.user.findUnique({
      where: { email: input.email },
      select: USER_SELECT,
    });
    if (!user) {
      throw new NotFoundException("No user with this email exists");
    }

    const existing = await this.prisma.workspaceMember.findUnique({
      where: { workspaceId_userId: { workspaceId, userId: user.id } },
    });
    if (existing) {
      throw new ConflictException("This user is already a member of the workspace");
    }

    const member = await this.prisma.workspaceMember.create({
      data: { workspaceId, userId: user.id, role: input.role },
      include: { user: { select: USER_SELECT } },
    });
    return toWorkspaceMember(member);
  }

  async updateMemberRole(
    workspaceId: string,
    targetUserId: string,
    input: UpdateMemberRole,
  ): Promise<WorkspaceMember> {
    const member = await this.prisma.workspaceMember.findUnique({
      where: { workspaceId_userId: { workspaceId, userId: targetUserId } },
    });
    if (!member) {
      throw new NotFoundException("This user is not a member of the workspace");
    }

    if (member.role === "OWNER" && input.role !== "OWNER") {
      await this.assertNotLastOwner(workspaceId, "You cannot demote the last owner of the workspace");
    }

    const updated = await this.prisma.workspaceMember.update({
      where: { workspaceId_userId: { workspaceId, userId: targetUserId } },
      data: { role: input.role },
      include: { user: { select: USER_SELECT } },
    });
    return toWorkspaceMember(updated);
  }

  async removeMember(workspaceId: string, targetUserId: string): Promise<void> {
    const member = await this.prisma.workspaceMember.findUnique({
      where: { workspaceId_userId: { workspaceId, userId: targetUserId } },
    });
    if (!member) {
      throw new NotFoundException("This user is not a member of the workspace");
    }

    if (member.role === "OWNER") {
      await this.assertNotLastOwner(workspaceId, "You cannot remove the last owner of the workspace");
    }

    await this.prisma.workspaceMember.delete({
      where: { workspaceId_userId: { workspaceId, userId: targetUserId } },
    });
  }

  /** Throws if the workspace currently has exactly one OWNER (the caller's target). */
  private async assertNotLastOwner(workspaceId: string, message: string): Promise<void> {
    const ownerCount = await this.prisma.workspaceMember.count({
      where: { workspaceId, role: "OWNER" },
    });
    if (ownerCount <= 1) {
      throw new BadRequestException(message);
    }
  }
}
