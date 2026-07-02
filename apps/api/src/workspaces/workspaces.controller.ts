import { Body, Controller, Delete, Get, Param, Patch, Post, UseGuards } from "@nestjs/common";
import {
  addMemberSchema,
  createWorkspaceSchema,
  updateMemberRoleSchema,
  updateWorkspaceSchema,
  type AddMember,
  type CreateWorkspace,
  type UpdateMemberRole,
  type UpdateWorkspace,
  type Workspace,
  type WorkspaceMember,
} from "@workflo/shared";
import type { AuthUser } from "@workflo/shared";
import { WorkspacesService } from "./workspaces.service.js";
import { JwtAuthGuard } from "../auth/guards/jwt-auth.guard.js";
import { CurrentUser } from "../auth/decorators/current-user.decorator.js";
import { ZodValidationPipe } from "../auth/zod-validation.pipe.js";
import { WorkspaceMemberGuard } from "../authz/guards/workspace-member.guard.js";
import { RolesGuard } from "../authz/guards/roles.guard.js";
import { Roles } from "../authz/decorators/roles.decorator.js";
import { ResolveWorkspaceFrom } from "../authz/decorators/resolve-workspace-from.decorator.js";

@Controller("workspaces")
@UseGuards(JwtAuthGuard)
export class WorkspacesController {
  constructor(private readonly workspacesService: WorkspacesService) {}

  @Post()
  async create(
    @CurrentUser() user: AuthUser,
    @Body(new ZodValidationPipe(createWorkspaceSchema)) body: CreateWorkspace,
  ): Promise<Workspace> {
    return this.workspacesService.create(user.id, body);
  }

  @Get()
  async list(@CurrentUser() user: AuthUser): Promise<Workspace[]> {
    return this.workspacesService.listForUser(user.id);
  }

  @Get(":id")
  @UseGuards(WorkspaceMemberGuard)
  @ResolveWorkspaceFrom("param:id")
  async getById(@Param("id") id: string): Promise<Workspace> {
    return this.workspacesService.getById(id);
  }

  @Patch(":id")
  @UseGuards(WorkspaceMemberGuard, RolesGuard)
  @ResolveWorkspaceFrom("param:id")
  @Roles("OWNER")
  async update(
    @Param("id") id: string,
    @Body(new ZodValidationPipe(updateWorkspaceSchema)) body: UpdateWorkspace,
  ): Promise<Workspace> {
    return this.workspacesService.update(id, body);
  }

  @Delete(":id")
  @UseGuards(WorkspaceMemberGuard, RolesGuard)
  @ResolveWorkspaceFrom("param:id")
  @Roles("OWNER")
  async remove(@Param("id") id: string): Promise<{ success: true }> {
    await this.workspacesService.remove(id);
    return { success: true };
  }

  @Get(":id/members")
  @UseGuards(WorkspaceMemberGuard)
  @ResolveWorkspaceFrom("param:id")
  async listMembers(@Param("id") id: string): Promise<WorkspaceMember[]> {
    return this.workspacesService.listMembers(id);
  }

  @Post(":id/members")
  @UseGuards(WorkspaceMemberGuard, RolesGuard)
  @ResolveWorkspaceFrom("param:id")
  @Roles("OWNER")
  async addMember(
    @Param("id") id: string,
    @Body(new ZodValidationPipe(addMemberSchema)) body: AddMember,
  ): Promise<WorkspaceMember> {
    return this.workspacesService.addMember(id, body);
  }

  @Patch(":id/members/:userId")
  @UseGuards(WorkspaceMemberGuard, RolesGuard)
  @ResolveWorkspaceFrom("param:id")
  @Roles("OWNER")
  async updateMemberRole(
    @Param("id") id: string,
    @Param("userId") userId: string,
    @Body(new ZodValidationPipe(updateMemberRoleSchema)) body: UpdateMemberRole,
  ): Promise<WorkspaceMember> {
    return this.workspacesService.updateMemberRole(id, userId, body);
  }

  @Delete(":id/members/:userId")
  @UseGuards(WorkspaceMemberGuard, RolesGuard)
  @ResolveWorkspaceFrom("param:id")
  @Roles("OWNER")
  async removeMember(@Param("id") id: string, @Param("userId") userId: string): Promise<{ success: true }> {
    await this.workspacesService.removeMember(id, userId);
    return { success: true };
  }
}
