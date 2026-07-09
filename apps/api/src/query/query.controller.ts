import { Body, Controller, HttpCode, HttpStatus, Post, UseGuards } from "@nestjs/common";
import { Throttle } from "@nestjs/throttler";
import { queryExecuteRequestSchema, type AuthUser, type QueryExecuteRequest } from "@workflo/shared";
import { QueryExecutionService, type QueryExecuteResult } from "./query-execution.service.js";
import { JwtAuthGuard } from "../auth/guards/jwt-auth.guard.js";
import { CurrentUser } from "../auth/decorators/current-user.decorator.js";
import { ZodValidationPipe } from "../auth/zod-validation.pipe.js";
import { WorkspaceMemberGuard } from "../authz/guards/workspace-member.guard.js";
import { ResolveWorkspaceFrom } from "../authz/decorators/resolve-workspace-from.decorator.js";
import { WorkspaceContext } from "../authz/decorators/workspace-context.decorator.js";
import type { WorkspaceContext as WorkspaceContextType } from "../authz/workspace-context.js";

@Controller("query")
@UseGuards(JwtAuthGuard)
export class QueryController {
  constructor(private readonly queryExecutionService: QueryExecutionService) {}

  /**
   * `POST /api/v1/query/execute` — the zero-LLM v1a engine (LLM parsing,
   * `/query/parse`, is a LATER task). `workspaceId` is read from the body
   * by `WorkspaceMemberGuard` (`body:workspaceId`, same strategy `POST
   * /projects` uses) BEFORE the Zod body pipe runs — guards execute ahead
   * of param-binding pipes in the Nest pipeline, so this 403s a non-member
   * exactly like every other workspace-scoped write. The AST itself is
   * never trusted for workspace scope (see QueryCompilerService's doc
   * comment) — `workspaceContext.workspaceId`, not `body.workspaceId`, is
   * what's passed to execution.
   *
   * `@HttpCode(OK)` — matches the existing convention for non-creating POST
   * actions (see auth.controller.ts's login/refresh); nothing is created
   * here. `@Throttle` raises this route's limit well above the app-wide
   * default (20/60s per route, per `AppModule`'s global `ThrottlerGuard`):
   * Lane A (docs/design/nlq-search.md §2.2) re-executes on every keystroke
   * behind a 250ms debounce, i.e. up to ~4 req/s of NORMAL usage from a
   * single fast typist — the app-wide default would 429 a real user typing
   * a search query, not just abuse.
   */
  @Post("execute")
  @HttpCode(HttpStatus.OK)
  @Throttle({ default: { limit: 300, ttl: 60_000 } })
  @UseGuards(WorkspaceMemberGuard)
  @ResolveWorkspaceFrom("body:workspaceId")
  async execute(
    @Body(new ZodValidationPipe(queryExecuteRequestSchema)) body: QueryExecuteRequest,
    @WorkspaceContext() workspaceContext: WorkspaceContextType,
    @CurrentUser() user: AuthUser,
  ): Promise<QueryExecuteResult> {
    return this.queryExecutionService.execute(
      body.ast,
      {
        workspaceId: workspaceContext.workspaceId,
        userId: user.id,
        now: new Date(),
        tzOffsetMinutes: body.tz ?? 0,
      },
      body.cursor,
      body.limit,
    );
  }
}
