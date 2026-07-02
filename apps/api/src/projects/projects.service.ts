import { ConflictException, Injectable, NotFoundException } from "@nestjs/common";
import type { CreateProject, Project, UpdateProject } from "@workflo/shared";
import { PrismaService } from "../prisma/prisma.service.js";

function toProject(project: {
  id: string;
  workspaceId: string;
  key: string;
  name: string;
  createdAt: Date;
}): Project {
  return {
    id: project.id,
    workspaceId: project.workspaceId,
    key: project.key,
    name: project.name,
    createdAt: project.createdAt,
  };
}

@Injectable()
export class ProjectsService {
  constructor(private readonly prisma: PrismaService) {}

  async create(input: CreateProject): Promise<Project> {
    const existing = await this.prisma.project.findUnique({
      where: { workspaceId_key: { workspaceId: input.workspaceId, key: input.key } },
    });
    if (existing) {
      throw new ConflictException("A project with this key already exists in the workspace");
    }

    const project = await this.prisma.project.create({
      data: { workspaceId: input.workspaceId, key: input.key, name: input.name },
    });
    return toProject(project);
  }

  async listByWorkspace(workspaceId: string): Promise<Project[]> {
    const projects = await this.prisma.project.findMany({
      where: { workspaceId },
      orderBy: { createdAt: "asc" },
    });
    return projects.map(toProject);
  }

  async getById(projectId: string): Promise<Project> {
    const project = await this.prisma.project.findUnique({ where: { id: projectId } });
    if (!project) {
      throw new NotFoundException("Project not found");
    }
    return toProject(project);
  }

  async update(projectId: string, input: UpdateProject): Promise<Project> {
    const project = await this.prisma.project.update({
      where: { id: projectId },
      data: { name: input.name },
    });
    return toProject(project);
  }

  async remove(projectId: string): Promise<void> {
    await this.prisma.project.delete({ where: { id: projectId } });
  }
}
