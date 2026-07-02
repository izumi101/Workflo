import { SetMetadata } from "@nestjs/common";
import type { Role } from "@workflo/shared";

export const ROLES_KEY = "workflo:roles";

/**
 * Marks a route as requiring one of the given workspace roles. Must be
 * combined with WorkspaceMemberGuard (which resolves the caller's role)
 * and RolesGuard (which enforces it) — see AuthzModule / controller usage.
 */
export const Roles = (...roles: Role[]) => SetMetadata(ROLES_KEY, roles);
