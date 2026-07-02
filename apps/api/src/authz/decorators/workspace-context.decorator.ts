import { createParamDecorator, ExecutionContext } from "@nestjs/common";
import type { WorkspaceContext as WorkspaceContextType } from "../workspace-context.js";

/**
 * Pulls the resolved { workspaceId, role } off the request. Only usable
 * behind WorkspaceMemberGuard, which attaches it after confirming
 * membership.
 */
export const WorkspaceContext = createParamDecorator(
  (_data: unknown, ctx: ExecutionContext): WorkspaceContextType => {
    const request = ctx.switchToHttp().getRequest();
    return request.workspaceContext;
  },
);
