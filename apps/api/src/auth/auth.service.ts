import { randomBytes, randomUUID, createHash } from "node:crypto";
import { ConflictException, Injectable, UnauthorizedException } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { JwtService } from "@nestjs/jwt";
import * as argon2 from "argon2";
import type { AuthUser, Login, Register } from "@workflo/shared";
import { PrismaService } from "../prisma/prisma.service.js";
import type { EnvConfig } from "../config/env.validation.js";
import type { GoogleProfile } from "./strategies/google.strategy.js";
import type { JwtPayload } from "./strategies/jwt.strategy.js";

export interface IssuedTokens {
  accessToken: string;
  refreshToken: string;
  user: AuthUser;
}

const MS_PER_UNIT = {
  s: 1000,
  m: 60_000,
  h: 3_600_000,
  d: 86_400_000,
} as const satisfies Record<string, number>;

type DurationUnit = keyof typeof MS_PER_UNIT;

/** Parses a duration string like "15m" / "7d" into milliseconds. */
function parseDurationMs(input: string): number {
  const match = /^(\d+)(s|m|h|d)$/.exec(input.trim());
  if (!match) {
    throw new Error(`Invalid duration format: "${input}" (expected e.g. "15m", "7d")`);
  }
  const amount = match[1] as string;
  const unit = match[2] as DurationUnit;
  return Number(amount) * MS_PER_UNIT[unit];
}

function hashToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

function toAuthUser(user: { id: string; email: string; name: string; avatarUrl: string | null }): AuthUser {
  return {
    id: user.id,
    email: user.email,
    name: user.name,
    avatarUrl: user.avatarUrl,
  };
}

@Injectable()
export class AuthService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly jwt: JwtService,
    private readonly config: ConfigService<EnvConfig, true>,
  ) {}

  async register(input: Register): Promise<IssuedTokens> {
    const existing = await this.prisma.user.findUnique({ where: { email: input.email } });
    if (existing) {
      throw new ConflictException("An account with this email already exists");
    }

    const passwordHash = await argon2.hash(input.password, { type: argon2.argon2id });

    const user = await this.prisma.user.create({
      data: {
        email: input.email,
        name: input.name,
        passwordHash,
      },
    });

    return this.issueTokens(toAuthUser(user));
  }

  async login(input: Login): Promise<IssuedTokens> {
    const user = await this.prisma.user.findUnique({ where: { email: input.email } });

    // Generic message regardless of failure reason — do not reveal whether
    // the email exists.
    const invalidCredentials = () => new UnauthorizedException("Invalid email or password");

    if (!user || !user.passwordHash) {
      throw invalidCredentials();
    }

    const valid = await argon2.verify(user.passwordHash, input.password);
    if (!valid) {
      throw invalidCredentials();
    }

    return this.issueTokens(toAuthUser(user));
  }

  /**
   * Upserts a user from a Google profile (email/name/avatar only — no
   * password) and issues our own tokens. Called from the controller's
   * google/callback handler.
   */
  async loginWithGoogle(profile: GoogleProfile): Promise<IssuedTokens> {
    const user = await this.prisma.user.upsert({
      where: { email: profile.email },
      update: {
        name: profile.name,
        avatarUrl: profile.avatarUrl,
      },
      create: {
        email: profile.email,
        name: profile.name,
        avatarUrl: profile.avatarUrl,
      },
    });

    return this.issueTokens(toAuthUser(user));
  }

  /** Signs a new access token and persists a fresh, rotated refresh token. */
  async issueTokens(user: AuthUser, family?: string): Promise<IssuedTokens> {
    const payload: JwtPayload = { sub: user.id, email: user.email };
    const accessToken = this.jwt.sign(payload);

    const refreshToken = randomBytes(32).toString("hex");
    const refreshTtl = this.config.get("JWT_REFRESH_TTL", { infer: true });
    const expiresAt = new Date(Date.now() + parseDurationMs(refreshTtl));

    await this.prisma.refreshToken.create({
      data: {
        userId: user.id,
        tokenHash: hashToken(refreshToken),
        family: family ?? randomUUID(),
        expiresAt,
      },
    });

    return { accessToken, refreshToken, user };
  }

  /**
   * Rotates a refresh token. On reuse of an already-revoked token (theft
   * indicator), the entire token family is revoked and the request rejected.
   */
  async refresh(presentedToken: string): Promise<IssuedTokens> {
    const tokenHash = hashToken(presentedToken);
    const stored = await this.prisma.refreshToken.findUnique({ where: { tokenHash } });

    if (!stored) {
      throw new UnauthorizedException("Invalid refresh token");
    }

    if (stored.revokedAt || stored.expiresAt < new Date()) {
      if (stored.revokedAt) {
        // Reuse of a rotated/revoked token — treat as theft, kill the family.
        await this.prisma.refreshToken.updateMany({
          where: { family: stored.family, revokedAt: null },
          data: { revokedAt: new Date() },
        });
      }
      throw new UnauthorizedException("Invalid refresh token");
    }

    const user = await this.prisma.user.findUnique({ where: { id: stored.userId } });
    if (!user) {
      throw new UnauthorizedException("Invalid refresh token");
    }

    await this.prisma.refreshToken.update({
      where: { id: stored.id },
      data: { revokedAt: new Date() },
    });

    return this.issueTokens(toAuthUser(user), stored.family);
  }

  /** Revokes the whole family a presented refresh token belongs to. */
  async logout(presentedToken: string): Promise<void> {
    const tokenHash = hashToken(presentedToken);
    const stored = await this.prisma.refreshToken.findUnique({ where: { tokenHash } });
    if (!stored) {
      return;
    }

    await this.prisma.refreshToken.updateMany({
      where: { family: stored.family, revokedAt: null },
      data: { revokedAt: new Date() },
    });
  }

  async me(userId: string): Promise<AuthUser> {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { id: true, email: true, name: true, avatarUrl: true },
    });
    if (!user) {
      throw new UnauthorizedException("User no longer exists");
    }
    return user;
  }
}
