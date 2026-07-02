import { Body, Controller, Delete, Get, Param, Patch, Post, Query, UseGuards } from "@nestjs/common";
import {
  createIssueSchema,
  issueListQuerySchema,
  updateIssueSchema,
  type AuthUser,
  type CreateIssue,
  type Issue,
  type IssueListQuery,
  type UpdateIssue,
} from "@workflo/shared";
import { IssuesService, type IssueListResult } from "./issues.service.js";
import { JwtAuthGuard } from "../auth/guards/jwt-auth.guard.js";
import { CurrentUser } from "../auth/decorators/current-user.decorator.js";
import { ZodValidationPipe, ZodQueryValidationPipe } from "../auth/zod-validation.pipe.js";
import { WorkspaceMemberGuard } from "../authz/guards/workspace-member.guard.js";
import { ResolveWorkspaceFrom } from "../authz/decorators/resolve-workspace-from.decorator.js";

@Controller()
@UseGuards(JwtAuthGuard)
export class IssuesController {
  constructor(private readonly issuesService: IssuesService) {}

  @Post("projects/:id/issues")
  @UseGuards(WorkspaceMemberGuard)
  @ResolveWorkspaceFrom("project:id")
  async create(
    @Param("id") projectId: string,
    @CurrentUser() user: AuthUser,
    @Body(new ZodValidationPipe(createIssueSchema)) body: CreateIssue,
  ): Promise<Issue> {
    return this.issuesService.create(projectId, user.id, body);
  }

  @Get("projects/:id/issues")
  @UseGuards(WorkspaceMemberGuard)
  @ResolveWorkspaceFrom("project:id")
  async list(
    @Param("id") projectId: string,
    @Query(new ZodQueryValidationPipe(issueListQuerySchema)) query: IssueListQuery,
  ): Promise<IssueListResult> {
    return this.issuesService.listByProject(projectId, query);
  }

  @Get("issues/:key")
  @UseGuards(WorkspaceMemberGuard)
  @ResolveWorkspaceFrom("issue:key")
  async getByKey(@Param("key") key: string): Promise<Issue> {
    return this.issuesService.getByKey(key);
  }

  @Patch("issues/:key")
  @UseGuards(WorkspaceMemberGuard)
  @ResolveWorkspaceFrom("issue:key")
  async update(
    @Param("key") key: string,
    @Body(new ZodValidationPipe(updateIssueSchema)) body: UpdateIssue,
  ): Promise<Issue> {
    return this.issuesService.update(key, body);
  }

  @Delete("issues/:key")
  @UseGuards(WorkspaceMemberGuard)
  @ResolveWorkspaceFrom("issue:key")
  async remove(@Param("key") key: string): Promise<{ success: true }> {
    await this.issuesService.remove(key);
    return { success: true };
  }
}
