import { Module } from "@nestjs/common";
import { IssuesController } from "./issues.controller.js";
import { IssuesService } from "./issues.service.js";
import { AuthzModule } from "../authz/authz.module.js";

@Module({
  imports: [AuthzModule],
  controllers: [IssuesController],
  providers: [IssuesService],
  exports: [IssuesService],
})
export class IssuesModule {}
