import { Module } from "@nestjs/common";
import { CommentsController } from "./comments.controller.js";
import { CommentsService } from "./comments.service.js";
import { AuthzModule } from "../authz/authz.module.js";
import { NotificationsQueueModule } from "../notifications/notifications-queue.module.js";

@Module({
  imports: [AuthzModule, NotificationsQueueModule],
  controllers: [CommentsController],
  providers: [CommentsService],
  exports: [CommentsService],
})
export class CommentsModule {}
