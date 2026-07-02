import { ForbiddenException, Injectable, type CanActivate, type ExecutionContext } from "@nestjs/common";
import { Reflector } from "@nestjs/core";
import type { Role } from "@workflo/shared";
import { ROLES_KEY } from "../decorators/roles.decorator.js";
import type { WorkspaceContext } from "../workspace-context.js";

/**
 * Enforces @Roles(...) against the membership role attached by
 * WorkspaceMemberGuard. Must run after WorkspaceMemberGuard (needs
 * `request.workspaceContext` to already be set). Routes with no @Roles()
 * metadata are allowed through (member-only access is already enforced by
 * WorkspaceMemberGuard itself).
 */
@Injectable()
export class RolesGuard implements CanActivate {
  constructor(private readonly reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    const requiredRoles = this.reflector.getAllAndOverride<Role[] | undefined>(ROLES_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);

    if (!requiredRoles || requiredRoles.length === 0) {
      return true;
    }

    const request = context.switchToHttp().getRequest();
    const workspaceContext: WorkspaceContext | undefined = request.workspaceContext;

    if (!workspaceContext || !requiredRoles.includes(workspaceContext.role)) {
      throw new ForbiddenException("You do not have permission to perform this action");
    }

    return true;
  }
}
