import { Module } from "@nestjs/common";
import { BullModule } from "@nestjs/bullmq";
import { ConfigModule, ConfigService } from "@nestjs/config";
import type { EnvConfig } from "../config/env.validation.js";
import { NOTIFICATIONS_QUEUE } from "./notification-job.js";

/**
 * Registers the `notifications` BullMQ queue against REDIS_URL. Imported by
 * BOTH producer modules (Comments, Issues — they only ever call
 * `queue.add(...)`, never write a Notification row directly) and by
 * NotificationsModule (which registers the `@Processor` worker that
 * consumes the queue). The worker runs IN-PROCESS in this same Nest app —
 * there is no separate deployable for it (see CLAUDE.md §8 for the decision).
 */
@Module({
  imports: [
    BullModule.forRootAsync({
      imports: [ConfigModule],
      inject: [ConfigService],
      useFactory: (config: ConfigService<EnvConfig, true>) => ({
        connection: {
          // ioredis accepts a connection string via `path`-less URL parsing;
          // BullMQ's `connection` option wants either a URL string or an
          // options object. Reuse REDIS_URL exactly like RedisIoAdapter does.
          url: config.get("REDIS_URL", { infer: true }),
        },
      }),
    }),
    BullModule.registerQueue({ name: NOTIFICATIONS_QUEUE }),
  ],
  exports: [BullModule],
})
export class NotificationsQueueModule {}
