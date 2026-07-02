import { Module } from "@nestjs/common";
import { ConfigModule, ConfigService } from "@nestjs/config";
import { JwtModule } from "@nestjs/jwt";
import { PassportModule } from "@nestjs/passport";
import { AuthController } from "./auth.controller.js";
import { AuthService } from "./auth.service.js";
import { JwtStrategy } from "./strategies/jwt.strategy.js";
import { GoogleStrategy } from "./strategies/google.strategy.js";
import { GoogleAuthGuard } from "./guards/google-auth.guard.js";
import type { EnvConfig } from "../config/env.validation.js";

/**
 * Auth module (ADR-0005). JwtModule signs only the short-lived ACCESS token —
 * the refresh token is an opaque random value persisted (hashed) by AuthService,
 * not a JWT.
 */
@Module({
  imports: [
    PassportModule,
    JwtModule.registerAsync({
      imports: [ConfigModule],
      inject: [ConfigService],
      useFactory: (config: ConfigService<EnvConfig, true>) => ({
        secret: config.get("JWT_ACCESS_SECRET", { infer: true }),
        signOptions: {
          expiresIn: config.get("JWT_ACCESS_TTL", { infer: true }),
        },
      }),
    }),
  ],
  controllers: [AuthController],
  providers: [AuthService, JwtStrategy, GoogleStrategy, GoogleAuthGuard],
  exports: [AuthService],
})
export class AuthModule {}
