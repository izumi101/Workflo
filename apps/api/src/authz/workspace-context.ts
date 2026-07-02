import type { Role } from "@workflo/shared";

/**
 * Attached to the request by WorkspaceMemberGuard once the caller's
 * membership in the target workspace has been resolved and confirmed.
 * Downstream guards/decorators (RolesGuard, @WorkspaceContext()) read this.
 */
export interface WorkspaceContext {
  workspaceId: string;
  role: Role;
}
