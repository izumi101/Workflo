import { Module } from "@nestjs/common";
import { TriageController } from "./triage.controller.js";
import { TriageService } from "./triage.service.js";
import { TriageCacheService } from "./triage-cache.service.js";
import { TriageCacheListener } from "./triage-cache.listener.js";
import { AuthzModule } from "../authz/authz.module.js";
import { QueryModule } from "../query/query.module.js";

@Module({
  imports: [AuthzModule, QueryModule],
  controllers: [TriageController],
  providers: [TriageService, TriageCacheService, TriageCacheListener],
})
export class TriageModule {}
