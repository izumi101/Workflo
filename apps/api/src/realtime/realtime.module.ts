import { Module } from "@nestjs/common";
import { ConfigModule, ConfigService } from "@nestjs/config";
import { JwtModule } from "@nestjs/jwt";
import type { EnvConfig } from "../config/env.validation.js";
import { RealtimeGateway } from "./realtime.gateway.js";
import { RealtimeListener } from "./realtime.listener.js";

/**
 * Real-time module (ADR-0003). Owns the Socket.IO gateway + the listener
 * that bridges internal domain events (issue.*) to room broadcasts. Reuses
 * JWT_ACCESS_SECRET (same JwtModule config shape as AuthModule) to verify
 * the handshake token — kept as its own JwtModule registration here so this
 * module has no hard dependency on AuthModule.
 */
@Module({
  imports: [
    JwtModule.registerAsync({
      imports: [ConfigModule],
      inject: [ConfigService],
      useFactory: (config: ConfigService<EnvConfig, true>) => ({
        secret: config.get("JWT_ACCESS_SECRET", { infer: true }),
      }),
    }),
  ],
  providers: [RealtimeGateway, RealtimeListener],
  exports: [RealtimeGateway],
})
export class RealtimeModule {}
