import { Module } from "@nestjs/common";
import { CommentsController } from "./comments.controller.js";
import { CommentsService } from "./comments.service.js";
import { AuthzModule } from "../authz/authz.module.js";

@Module({
  imports: [AuthzModule],
  controllers: [CommentsController],
  providers: [CommentsService],
  exports: [CommentsService],
})
export class CommentsModule {}
