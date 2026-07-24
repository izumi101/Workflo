import { Body, Controller, Delete, Get, Param, Patch, Post, Query, UseGuards } from "@nestjs/common";
import {
  createViewSchema,
  updateViewSchema,
  viewListQuerySchema,
  type AuthUser,
  type CreateView,
  type UpdateView,
  type View,
  type ViewListQuery,
} from "@workflo/shared";
import { ViewsService } from "./views.service.js";
import { JwtAuthGuard } from "../auth/guards/jwt-auth.guard.js";
import { CurrentUser } from "../auth/decorators/current-user.decorator.js";
import { ZodValidationPipe, ZodQueryValidationPipe } from "../auth/zod-validation.pipe.js";
import { WorkspaceMemberGuard } from "../authz/guards/workspace-member.guard.js";
import { ResolveWorkspaceFrom } from "../authz/decorators/resolve-workspace-from.decorator.js";
import { WorkspaceContext } from "../authz/decorators/workspace-context.decorator.js";
import type { WorkspaceContext as WorkspaceContextType } from "../authz/workspace-context.js";

/**
 * Saved Views API. Unlike Notifications (pure JwtAuthGuard, user-scoped),
 * Views need WorkspaceMemberGuard on every route — a View belongs to a
 * workspace, WORKSPACE-scope views are shared with every member, and
 * editing one is OWNER-or-creator, none of which is expressible from the
 * JWT alone (see views.service.ts's header comment for the full rationale).
 */
@Controller("views")
@UseGuards(JwtAuthGuard)
export class ViewsController {
  constructor(private readonly viewsService: ViewsService) {}

  @Get()
  @UseGuards(WorkspaceMemberGuard)
  @ResolveWorkspaceFrom("query:workspaceId")
  async list(
    @Query(new ZodQueryValidationPipe(viewListQuerySchema)) query: ViewListQuery,
    @CurrentUser() user: AuthUser,
  ): Promise<View[]> {
    return this.viewsService.listForUser(query.workspaceId, user.id);
  }

  @Post()
  @UseGuards(WorkspaceMemberGuard)
  @ResolveWorkspaceFrom("body:workspaceId")
  async create(
    @Body(new ZodValidationPipe(createViewSchema)) body: CreateView,
    @CurrentUser() user: AuthUser,
  ): Promise<View> {
    return this.viewsService.create(user.id, body);
  }

  @Patch(":id")
  @UseGuards(WorkspaceMemberGuard)
  @ResolveWorkspaceFrom("view:id")
  async update(
    @Param("id") id: string,
    @Body(new ZodValidationPipe(updateViewSchema)) body: UpdateView,
    @CurrentUser() user: AuthUser,
    @WorkspaceContext() workspaceContext: WorkspaceContextType,
  ): Promise<View> {
    return this.viewsService.update(id, user.id, workspaceContext.role, body);
  }

  @Delete(":id")
  @UseGuards(WorkspaceMemberGuard)
  @ResolveWorkspaceFrom("view:id")
  async remove(
    @Param("id") id: string,
    @CurrentUser() user: AuthUser,
    @WorkspaceContext() workspaceContext: WorkspaceContextType,
  ): Promise<View> {
    return this.viewsService.remove(id, user.id, workspaceContext.role);
  }
}
