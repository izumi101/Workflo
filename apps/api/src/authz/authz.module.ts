import { Module } from "@nestjs/common";
import { WorkspaceMemberGuard } from "./guards/workspace-member.guard.js";
import { RolesGuard } from "./guards/roles.guard.js";

/**
 * Authorization building blocks shared by any module with workspace-scoped
 * routes (Workspaces, Projects, and later Issues/Comments). Guards are
 * request-scoped via @UseGuards(...) in controllers, not applied globally —
 * this module just makes them DI-resolvable with their dependencies
 * (Reflector, PrismaService) outside of PrismaModule's own consumers.
 */
@Module({
  providers: [WorkspaceMemberGuard, RolesGuard],
  exports: [WorkspaceMemberGuard, RolesGuard],
})
export class AuthzModule {}
