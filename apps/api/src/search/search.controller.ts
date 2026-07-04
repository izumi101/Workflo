import { Controller, Get, Query, UseGuards } from "@nestjs/common";
import { searchQuerySchema, type SearchQuery, type SearchResult } from "@workflo/shared";
import { SearchService } from "./search.service.js";
import { JwtAuthGuard } from "../auth/guards/jwt-auth.guard.js";
import { ZodQueryValidationPipe } from "../auth/zod-validation.pipe.js";
import { WorkspaceMemberGuard } from "../authz/guards/workspace-member.guard.js";
import { ResolveWorkspaceFrom } from "../authz/decorators/resolve-workspace-from.decorator.js";

@Controller()
@UseGuards(JwtAuthGuard)
export class SearchController {
  constructor(private readonly searchService: SearchService) {}

  @Get("search")
  @UseGuards(WorkspaceMemberGuard)
  @ResolveWorkspaceFrom("query:workspaceId")
  async search(
    @Query(new ZodQueryValidationPipe(searchQuerySchema)) query: SearchQuery,
  ): Promise<{ items: SearchResult[] }> {
    const items = await this.searchService.search(query);
    return { items };
  }
}
