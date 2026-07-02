import { Module } from "@nestjs/common";
import { LabelsController } from "./labels.controller.js";
import { LabelsService } from "./labels.service.js";
import { AuthzModule } from "../authz/authz.module.js";

@Module({
  imports: [AuthzModule],
  controllers: [LabelsController],
  providers: [LabelsService],
  exports: [LabelsService],
})
export class LabelsModule {}
