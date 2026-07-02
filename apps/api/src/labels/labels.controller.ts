import { Body, Controller, Delete, Get, Param, Post, UseGuards } from "@nestjs/common";
import { createLabelSchema, type CreateLabel, type Label } from "@workflo/shared";
import { LabelsService } from "./labels.service.js";
import { JwtAuthGuard } from "../auth/guards/jwt-auth.guard.js";
import { ZodValidationPipe } from "../auth/zod-validation.pipe.js";
import { WorkspaceMemberGuard } from "../authz/guards/workspace-member.guard.js";
import { ResolveWorkspaceFrom } from "../authz/decorators/resolve-workspace-from.decorator.js";

@Controller()
@UseGuards(JwtAuthGuard)
export class LabelsController {
  constructor(private readonly labelsService: LabelsService) {}

  @Post("projects/:id/labels")
  @UseGuards(WorkspaceMemberGuard)
  @ResolveWorkspaceFrom("project:id")
  async create(
    @Param("id") projectId: string,
    @Body(new ZodValidationPipe(createLabelSchema)) body: CreateLabel,
  ): Promise<Label> {
    return this.labelsService.create(projectId, body);
  }

  @Get("projects/:id/labels")
  @UseGuards(WorkspaceMemberGuard)
  @ResolveWorkspaceFrom("project:id")
  async list(@Param("id") projectId: string): Promise<Label[]> {
    return this.labelsService.listByProject(projectId);
  }

  @Delete("labels/:id")
  @UseGuards(WorkspaceMemberGuard)
  @ResolveWorkspaceFrom("label:id")
  async remove(@Param("id") id: string): Promise<{ success: true }> {
    await this.labelsService.remove(id);
    return { success: true };
  }
}
