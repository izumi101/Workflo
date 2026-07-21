import { Module } from "@nestjs/common";
import { QueryController } from "./query.controller.js";
import { QueryCompilerService } from "./query-compiler.service.js";
import { QueryExecutionService } from "./query-execution.service.js";
import { AuthzModule } from "../authz/authz.module.js";

@Module({
  imports: [AuthzModule],
  controllers: [QueryController],
  providers: [QueryCompilerService, QueryExecutionService],
  exports: [QueryCompilerService, QueryExecutionService],
})
export class QueryModule {}
