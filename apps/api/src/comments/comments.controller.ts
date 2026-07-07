import { Body, Controller, Delete, Get, Param, Patch, Post, Query, UseGuards } from "@nestjs/common";
import {
  commentListQuerySchema,
  createCommentSchema,
  updateCommentSchema,
  type AuthUser,
  type CommentListQuery,
  type CommentWithAuthor,
  type CreateComment,
  type UpdateComment,
} from "@workflo/shared";
import { CommentsService, type CommentListResult } from "./comments.service.js";
import { JwtAuthGuard } from "../auth/guards/jwt-auth.guard.js";
import { CurrentUser } from "../auth/decorators/current-user.decorator.js";
import { ZodValidationPipe, ZodQueryValidationPipe } from "../auth/zod-validation.pipe.js";
import { WorkspaceMemberGuard } from "../authz/guards/workspace-member.guard.js";
import { ResolveWorkspaceFrom } from "../authz/decorators/resolve-workspace-from.decorator.js";
import { WorkspaceContext } from "../authz/decorators/workspace-context.decorator.js";
import type { WorkspaceContext as WorkspaceContextType } from "../authz/workspace-context.js";

@Controller()
@UseGuards(JwtAuthGuard)
export class CommentsController {
  constructor(private readonly commentsService: CommentsService) {}

  @Get("issues/:key/comments")
  @UseGuards(WorkspaceMemberGuard)
  @ResolveWorkspaceFrom("issue:key")
  async list(
    @Param("key") key: string,
    @WorkspaceContext() workspaceContext: WorkspaceContextType,
    @Query(new ZodQueryValidationPipe(commentListQuerySchema)) query: CommentListQuery,
  ): Promise<CommentListResult> {
    return this.commentsService.listByIssueKey(key, workspaceContext.workspaceId, query);
  }

  @Post("issues/:key/comments")
  @UseGuards(WorkspaceMemberGuard)
  @ResolveWorkspaceFrom("issue:key")
  async create(
    @Param("key") key: string,
    @WorkspaceContext() workspaceContext: WorkspaceContextType,
    @CurrentUser() user: AuthUser,
    @Body(new ZodValidationPipe(createCommentSchema)) body: CreateComment,
  ): Promise<CommentWithAuthor> {
    return this.commentsService.create(key, workspaceContext.workspaceId, user.id, body);
  }

  @Patch("comments/:id")
  @UseGuards(WorkspaceMemberGuard)
  @ResolveWorkspaceFrom("comment:id")
  async update(
    @Param("id") id: string,
    @CurrentUser() user: AuthUser,
    @Body(new ZodValidationPipe(updateCommentSchema)) body: UpdateComment,
  ): Promise<CommentWithAuthor> {
    return this.commentsService.update(id, user.id, body);
  }

  @Delete("comments/:id")
  @UseGuards(WorkspaceMemberGuard)
  @ResolveWorkspaceFrom("comment:id")
  async remove(
    @Param("id") id: string,
    @CurrentUser() user: AuthUser,
    @WorkspaceContext() workspaceContext: WorkspaceContextType,
  ): Promise<{ success: true }> {
    await this.commentsService.remove(id, user.id, workspaceContext);
    return { success: true };
  }
}
