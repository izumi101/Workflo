import { Module } from "@nestjs/common";
import { IssuesController } from "./issues.controller.js";
import { IssuesService } from "./issues.service.js";
import { AuthzModule } from "../authz/authz.module.js";
import { NotificationsQueueModule } from "../notifications/notifications-queue.module.js";

@Module({
  imports: [AuthzModule, NotificationsQueueModule],
  controllers: [IssuesController],
  providers: [IssuesService],
  exports: [IssuesService],
})
export class IssuesModule {}
