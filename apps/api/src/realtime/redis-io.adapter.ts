import { IoAdapter } from "@nestjs/platform-socket.io";
import type { INestApplicationContext } from "@nestjs/common";
import type { ServerOptions } from "socket.io";
import { createAdapter } from "@socket.io/redis-adapter";
import Redis from "ioredis";
import { ConfigService } from "@nestjs/config";
import type { EnvConfig } from "../config/env.validation.js";

/**
 * Socket.IO adapter wired to Redis pub/sub (ADR-0003) so events fan out
 * across every API pod, not just the one holding the socket. Installed once
 * in main.ts via `app.useWebSocketAdapter(new RedisIoAdapter(app))`.
 */
export class RedisIoAdapter extends IoAdapter {
  private adapterConstructor?: ReturnType<typeof createAdapter>;
  private pubClient?: Redis;
  private subClient?: Redis;

  constructor(private readonly app: INestApplicationContext) {
    super(app);
  }

  async connectToRedis(): Promise<void> {
    const config = this.app.get(ConfigService<EnvConfig, true>);
    const redisUrl = config.get("REDIS_URL", { infer: true });

    this.pubClient = new Redis(redisUrl);
    this.subClient = this.pubClient.duplicate();

    this.adapterConstructor = createAdapter(this.pubClient, this.subClient);
  }

  createIOServer(port: number, options?: ServerOptions): any {
    const server = super.createIOServer(port, options);
    if (this.adapterConstructor) {
      server.adapter(this.adapterConstructor);
    }
    return server;
  }

  async close(): Promise<void> {
    await Promise.all([this.pubClient?.quit(), this.subClient?.quit()]);
  }
}
