import {
  BadRequestException,
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Post,
  Req,
  Res,
  UseGuards,
} from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { Throttle } from "@nestjs/throttler";
import type { Request, Response } from "express";
import {
  loginSchema,
  registerSchema,
  type AuthResponse,
  type Login,
  type Register,
} from "@workflo/shared";
import { AuthService } from "./auth.service.js";
import { ZodValidationPipe } from "./zod-validation.pipe.js";
import { JwtAuthGuard } from "./guards/jwt-auth.guard.js";
import { GoogleAuthGuard } from "./guards/google-auth.guard.js";
import { CurrentUser } from "./decorators/current-user.decorator.js";
import type { EnvConfig } from "../config/env.validation.js";
import type { GoogleProfile } from "./strategies/google.strategy.js";
import type { AuthUser } from "@workflo/shared";

const REFRESH_COOKIE_NAME = "refresh_token";
const REFRESH_COOKIE_PATH = "/api/v1/auth";

@Controller("auth")
export class AuthController {
  constructor(
    private readonly authService: AuthService,
    private readonly config: ConfigService<EnvConfig, true>,
  ) {}

  private setRefreshCookie(res: Response, token: string): void {
    res.cookie(REFRESH_COOKIE_NAME, token, {
      httpOnly: true,
      secure: this.config.get("NODE_ENV", { infer: true }) === "production",
      sameSite: "strict",
      path: REFRESH_COOKIE_PATH,
    });
  }

  private clearRefreshCookie(res: Response): void {
    res.clearCookie(REFRESH_COOKIE_NAME, {
      httpOnly: true,
      secure: this.config.get("NODE_ENV", { infer: true }) === "production",
      sameSite: "strict",
      path: REFRESH_COOKIE_PATH,
    });
  }

  @Post("register")
  @Throttle({ default: { limit: 5, ttl: 60000 } })
  async register(
    @Body(new ZodValidationPipe(registerSchema)) body: Register,
    @Res({ passthrough: true }) res: Response,
  ): Promise<AuthResponse> {
    const { accessToken, refreshToken, user } = await this.authService.register(body);
    this.setRefreshCookie(res, refreshToken);
    return { accessToken, user };
  }

  @Post("login")
  @Throttle({ default: { limit: 5, ttl: 60000 } })
  async login(
    @Body(new ZodValidationPipe(loginSchema)) body: Login,
    @Res({ passthrough: true }) res: Response,
  ): Promise<AuthResponse> {
    const { accessToken, refreshToken, user } = await this.authService.login(body);
    this.setRefreshCookie(res, refreshToken);
    return { accessToken, user };
  }

  @Post("refresh")
  @HttpCode(HttpStatus.OK)
  async refresh(@Req() req: Request, @Res({ passthrough: true }) res: Response): Promise<AuthResponse> {
    const presentedToken = req.cookies?.[REFRESH_COOKIE_NAME];
    if (!presentedToken) {
      throw new BadRequestException("Missing refresh token");
    }

    const { accessToken, refreshToken, user } = await this.authService.refresh(presentedToken);
    this.setRefreshCookie(res, refreshToken);
    return { accessToken, user };
  }

  @Post("logout")
  @HttpCode(HttpStatus.OK)
  async logout(@Req() req: Request, @Res({ passthrough: true }) res: Response): Promise<{ success: true }> {
    const presentedToken = req.cookies?.[REFRESH_COOKIE_NAME];
    if (presentedToken) {
      await this.authService.logout(presentedToken);
    }
    this.clearRefreshCookie(res);
    return { success: true };
  }

  @Get("me")
  @UseGuards(JwtAuthGuard)
  async me(@CurrentUser() user: AuthUser): Promise<AuthUser> {
    return this.authService.me(user.id);
  }

  @Get("google")
  @UseGuards(GoogleAuthGuard)
  async googleAuth(): Promise<void> {
    // GoogleAuthGuard intercepts and redirects to Google (or throws 501 if
    // unconfigured) before this body ever runs.
  }

  @Get("google/callback")
  @UseGuards(GoogleAuthGuard)
  async googleCallback(@Req() req: Request, @Res({ passthrough: true }) res: Response): Promise<AuthResponse> {
    const profile = req.user as GoogleProfile;
    const { accessToken, refreshToken, user } = await this.authService.loginWithGoogle(profile);
    this.setRefreshCookie(res, refreshToken);
    return { accessToken, user };
  }
}
