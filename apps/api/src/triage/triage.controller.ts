import { Body, Controller, Get, HttpCode, HttpStatus, Post, Query, UseGuards } from "@nestjs/common";
import { Throttle } from "@nestjs/throttler";
import {
  triageDismissRequestSchema,
  triageQuerySchema,
  triageSeenRequestSchema,
  type AuthUser,
  type TriageDismissRequest,
  type TriageQuery,
  type TriageResponse,
  type TriageSeenRequest,
} from "@workflo/shared";
import { TriageService } from "./triage.service.js";
import { JwtAuthGuard } from "../auth/guards/jwt-auth.guard.js";
import { CurrentUser } from "../auth/decorators/current-user.decorator.js";
import { ZodValidationPipe, ZodQueryValidationPipe } from "../auth/zod-validation.pipe.js";
import { WorkspaceMemberGuard } from "../authz/guards/workspace-member.guard.js";
import { ResolveWorkspaceFrom } from "../authz/decorators/resolve-workspace-from.decorator.js";
import { WorkspaceContext } from "../authz/decorators/workspace-context.decorator.js";
import type { WorkspaceContext as WorkspaceContextType } from "../authz/workspace-context.js";

@Controller("triage")
@UseGuards(JwtAuthGuard)
export class TriageController {
  constructor(private readonly triageService: TriageService) {}

  /**
   * `@Throttle` raises this route's limit above the app-wide default (20/60s
   * per route per IP, per `AppModule`'s global `ThrottlerGuard`) — same
   * reasoning as `query.controller.ts`'s `/query/execute`: the tracker keys
   * on IP alone, not per-user, so a handful of real users behind one office/
   * NAT IP polling `/triage` (panel open, focus-refetch, the rail's badge)
   * would otherwise 429 normal usage, not just abuse.
   */
  @Get()
  @Throttle({ default: { limit: 120, ttl: 60_000 } })
  @UseGuards(WorkspaceMemberGuard)
  @ResolveWorkspaceFrom("query:workspaceId")
  async getTriage(
    @Query(new ZodQueryValidationPipe(triageQuerySchema)) query: TriageQuery,
    @WorkspaceContext() workspaceContext: WorkspaceContextType,
    @CurrentUser() user: AuthUser,
  ): Promise<TriageResponse> {
    return this.triageService.getTriage(workspaceContext.workspaceId, user.id, new Date(), query.tz ?? 0);
  }

  @Post("dismiss")
  @HttpCode(HttpStatus.OK)
  @UseGuards(WorkspaceMemberGuard)
  @ResolveWorkspaceFrom("issue:body-id")
  async dismiss(
    @Body(new ZodValidationPipe(triageDismissRequestSchema)) body: TriageDismissRequest,
    @CurrentUser() user: AuthUser,
  ): Promise<{ ok: true }> {
    return this.triageService.dismiss(user.id, body.issueId, body.section, new Date());
  }

  @Post("seen")
  @HttpCode(HttpStatus.OK)
  @UseGuards(WorkspaceMemberGuard)
  @ResolveWorkspaceFrom("body:workspaceId")
  async markSeen(
    @Body(new ZodValidationPipe(triageSeenRequestSchema)) _body: TriageSeenRequest,
    @WorkspaceContext() workspaceContext: WorkspaceContextType,
    @CurrentUser() user: AuthUser,
  ): Promise<{ ok: true }> {
    return this.triageService.markSeen(user.id, workspaceContext.workspaceId, new Date());
  }
}
