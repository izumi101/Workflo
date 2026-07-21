import { Module } from "@nestjs/common";
import { ViewsController } from "./views.controller.js";
import { ViewsService } from "./views.service.js";
import { AuthzModule } from "../authz/authz.module.js";

@Module({
  imports: [AuthzModule],
  controllers: [ViewsController],
  providers: [ViewsService],
  exports: [ViewsService],
})
export class ViewsModule {}
