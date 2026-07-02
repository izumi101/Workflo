import { ConflictException, Injectable, NotFoundException } from "@nestjs/common";
import type { CreateLabel, Label } from "@workflo/shared";
import { PrismaService } from "../prisma/prisma.service.js";

function toLabel(label: { id: string; projectId: string; name: string; color: string }): Label {
  return {
    id: label.id,
    projectId: label.projectId,
    name: label.name,
    color: label.color,
  };
}

@Injectable()
export class LabelsService {
  constructor(private readonly prisma: PrismaService) {}

  async create(projectId: string, input: CreateLabel): Promise<Label> {
    const existing = await this.prisma.label.findUnique({
      where: { projectId_name: { projectId, name: input.name } },
    });
    if (existing) {
      throw new ConflictException("A label with this name already exists in the project");
    }

    const label = await this.prisma.label.create({
      data: { projectId, name: input.name, color: input.color },
    });
    return toLabel(label);
  }

  async listByProject(projectId: string): Promise<Label[]> {
    const labels = await this.prisma.label.findMany({
      where: { projectId },
      orderBy: { name: "asc" },
    });
    return labels.map(toLabel);
  }

  async remove(labelId: string): Promise<void> {
    const label = await this.prisma.label.findUnique({ where: { id: labelId } });
    if (!label) {
      throw new NotFoundException("Label not found");
    }
    await this.prisma.label.delete({ where: { id: labelId } });
  }
}
