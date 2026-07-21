import {
  ForbiddenException,
  Injectable,
  NotFoundException,
  type CanActivate,
  type ExecutionContext,
} from "@nestjs/common";
import { Reflector } from "@nestjs/core";
import { PrismaService } from "../../prisma/prisma.service.js";
import { parseIssueKey } from "../../common/issue-key.js";
import {
  RESOLVE_WORKSPACE_FROM_KEY,
  type WorkspaceResolutionStrategy,
} from "../decorators/resolve-workspace-from.decorator.js";
import type { WorkspaceContext } from "../workspace-context.js";

/**
 * Resolves the target workspace for the current request (see
 * @ResolveWorkspaceFrom for the resolution strategies), then:
 *  - 404s if the workspace (or, for "project:id", the project) doesn't exist.
 *  - 403s if the caller has no WorkspaceMember row for it.
 *  - Otherwise attaches `{ workspaceId, role }` to the request as
 *    `request.workspaceContext` for downstream guards/decorators.
 *
 * Must run after JwtAuthGuard (needs `request.user` to already be set).
 */
@Injectable()
export class WorkspaceMemberGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly prisma: PrismaService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest();
    const strategy =
      this.reflector.getAllAndOverride<WorkspaceResolutionStrategy | undefined>(
        RESOLVE_WORKSPACE_FROM_KEY,
        [context.getHandler(), context.getClass()],
      ) ?? "param:id";

    const workspaceId = await this.resolveWorkspaceId(strategy, request);

    const workspace = await this.prisma.workspace.findUnique({ where: { id: workspaceId } });
    if (!workspace) {
      throw new NotFoundException("Workspace not found");
    }

    const userId = request.user?.id;
    const membership = await this.prisma.workspaceMember.findUnique({
      where: { workspaceId_userId: { workspaceId, userId } },
    });

    if (!membership) {
      throw new ForbiddenException("You are not a member of this workspace");
    }

    const workspaceContext: WorkspaceContext = { workspaceId, role: membership.role };
    request.workspaceContext = workspaceContext;

    return true;
  }

  private async resolveWorkspaceId(
    strategy: WorkspaceResolutionStrategy,
    request: any,
  ): Promise<string> {
    switch (strategy) {
      case "param:workspaceId":
        return this.require(request.params?.workspaceId, "workspaceId param");
      case "param:id":
        return this.require(request.params?.id, "id param");
      case "body:workspaceId":
        return this.require(request.body?.workspaceId, "workspaceId in body");
      case "query:workspaceId":
        return this.require(request.query?.workspaceId, "workspaceId in query");
      case "project:id": {
        const projectId = this.require(request.params?.id, "id param");
        const project = await this.prisma.project.findUnique({ where: { id: projectId } });
        if (!project) {
          throw new NotFoundException("Project not found");
        }
        return project.workspaceId;
      }
      case "issue:key": {
        // Project.key is only unique WITHIN a workspace (@@unique([workspaceId, key])),
        // so multiple workspaces can have a project with the same key. Two
        // workspaces can each have a project keyed "WF" with an issue
        // numbered 1, both resolving to the SAME human key "WF-1". Resolving
        // globally (first match across ALL workspaces, in creation order)
        // would let a caller in workspace1 be authorized against workspace2's
        // issue of the same key, or leak/act on the wrong workspace's data
        // entirely.
        //
        // Restrict resolution to workspaces the CALLER is already a member
        // of. If a matching issue is found under that constraint, the caller
        // is provably a member of its workspace (authorized) and it's the
        // correct issue for that caller — return its workspaceId directly.
        //
        // If nothing matches within the caller's own workspaces, preserve the
        // existing not-found/forbidden semantics: check whether the key
        // exists in ANY workspace. If it does (just not one the caller
        // belongs to), 403 as before (no foreign existence leak via a 404).
        // If it doesn't exist anywhere, 404.
        const rawKey = this.require(request.params?.key, "key param");
        const { projectKey, number } = parseIssueKey(rawKey);
        const userId = request.user?.id;
        const issue = await this.prisma.issue.findFirst({
          where: {
            number,
            project: { key: projectKey, workspace: { members: { some: { userId } } } },
          },
          select: { project: { select: { workspaceId: true } } },
        });
        if (issue) {
          return issue.project.workspaceId;
        }

        const existsElsewhere = await this.prisma.issue.findFirst({
          where: { number, project: { key: projectKey } },
          select: { id: true },
        });
        if (!existsElsewhere) {
          throw new NotFoundException("Issue not found");
        }
        throw new ForbiddenException("You are not a member of this workspace");
      }
      case "label:id": {
        const labelId = this.require(request.params?.id, "id param");
        const label = await this.prisma.label.findUnique({
          where: { id: labelId },
          select: { project: { select: { workspaceId: true } } },
        });
        if (!label) {
          throw new NotFoundException("Label not found");
        }
        return label.project.workspaceId;
      }
      case "comment:id": {
        const commentId = this.require(request.params?.id, "id param");
        const comment = await this.prisma.comment.findUnique({
          where: { id: commentId },
          select: { issue: { select: { project: { select: { workspaceId: true } } } } },
        });
        if (!comment) {
          throw new NotFoundException("Comment not found");
        }
        return comment.issue.project.workspaceId;
      }
      case "view:id": {
        const viewId = this.require(request.params?.id, "id param");
        const view = await this.prisma.view.findUnique({
          where: { id: viewId },
          select: { workspaceId: true },
        });
        if (!view) {
          throw new NotFoundException("View not found");
        }
        return view.workspaceId;
      }
      default:
        throw new NotFoundException("Workspace not found");
    }
  }

  private require(value: unknown, label: string): string {
    if (typeof value !== "string" || value.length === 0) {
      throw new NotFoundException(`Workspace not found (missing ${label})`);
    }
    return value;
  }
}
