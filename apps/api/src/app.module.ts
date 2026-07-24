import { Module } from "@nestjs/common";
import { ConfigModule } from "@nestjs/config";
import { APP_GUARD } from "@nestjs/core";
import { EventEmitterModule } from "@nestjs/event-emitter";
import { ThrottlerGuard, ThrottlerModule } from "@nestjs/throttler";
import { validateEnv } from "./config/env.validation.js";
import { HealthModule } from "./health/health.module.js";
import { PrismaModule } from "./prisma/prisma.module.js";
import { AuthModule } from "./auth/auth.module.js";
import { WorkspacesModule } from "./workspaces/workspaces.module.js";
import { ProjectsModule } from "./projects/projects.module.js";
import { IssuesModule } from "./issues/issues.module.js";
import { LabelsModule } from "./labels/labels.module.js";
import { CommentsModule } from "./comments/comments.module.js";
import { RealtimeModule } from "./realtime/realtime.module.js";
import { SearchModule } from "./search/search.module.js";
import { NotificationsModule } from "./notifications/notifications.module.js";
import { QueryModule } from "./query/query.module.js";
import { ViewsModule } from "./views/views.module.js";
import { TriageModule } from "./triage/triage.module.js";

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      validate: validateEnv,
    }),
    EventEmitterModule.forRoot(),
    ThrottlerModule.forRoot([
      {
        ttl: 60000,
        limit: 20,
      },
    ]),
    PrismaModule,
    HealthModule,
    AuthModule,
    WorkspacesModule,
    ProjectsModule,
    IssuesModule,
    LabelsModule,
    CommentsModule,
    RealtimeModule,
    SearchModule,
    NotificationsModule,
    QueryModule,
    ViewsModule,
    TriageModule,
  ],
  providers: [
    {
      provide: APP_GUARD,
      useClass: ThrottlerGuard,
    },
  ],
})
export class AppModule {}
