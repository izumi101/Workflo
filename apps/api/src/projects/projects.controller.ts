import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
  Post,
  Query,
  UseGuards,
} from "@nestjs/common";
import {
  createProjectSchema,
  updateProjectSchema,
  type CreateProject,
  type Project,
  type UpdateProject,
} from "@workflo/shared";
import { ProjectsService } from "./projects.service.js";
import { JwtAuthGuard } from "../auth/guards/jwt-auth.guard.js";
import { ZodValidationPipe } from "../auth/zod-validation.pipe.js";
import { WorkspaceMemberGuard } from "../authz/guards/workspace-member.guard.js";
import { RolesGuard } from "../authz/guards/roles.guard.js";
import { Roles } from "../authz/decorators/roles.decorator.js";
import { ResolveWorkspaceFrom } from "../authz/decorators/resolve-workspace-from.decorator.js";

@Controller("projects")
@UseGuards(JwtAuthGuard)
export class ProjectsController {
  constructor(private readonly projectsService: ProjectsService) {}

  @Post()
  @UseGuards(WorkspaceMemberGuard)
  @ResolveWorkspaceFrom("body:workspaceId")
  async create(
    @Body(new ZodValidationPipe(createProjectSchema)) body: CreateProject,
  ): Promise<Project> {
    return this.projectsService.create(body);
  }

  @Get()
  @UseGuards(WorkspaceMemberGuard)
  @ResolveWorkspaceFrom("query:workspaceId")
  async list(@Query("workspaceId") workspaceId?: string): Promise<Project[]> {
    if (!workspaceId) {
      throw new BadRequestException("workspaceId query param is required");
    }
    return this.projectsService.listByWorkspace(workspaceId);
  }

  @Get(":id")
  @UseGuards(WorkspaceMemberGuard)
  @ResolveWorkspaceFrom("project:id")
  async getById(@Param("id") id: string): Promise<Project> {
    return this.projectsService.getById(id);
  }

  @Patch(":id")
  @UseGuards(WorkspaceMemberGuard)
  @ResolveWorkspaceFrom("project:id")
  async update(
    @Param("id") id: string,
    @Body(new ZodValidationPipe(updateProjectSchema)) body: UpdateProject,
  ): Promise<Project> {
    return this.projectsService.update(id, body);
  }

  @Delete(":id")
  @UseGuards(WorkspaceMemberGuard, RolesGuard)
  @ResolveWorkspaceFrom("project:id")
  @Roles("OWNER")
  async remove(@Param("id") id: string): Promise<{ success: true }> {
    await this.projectsService.remove(id);
    return { success: true };
  }
}
