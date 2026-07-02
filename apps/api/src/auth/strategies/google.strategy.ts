import { Injectable } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { PassportStrategy } from "@nestjs/passport";
import { Strategy, type Profile, type VerifyCallback } from "passport-google-oauth20";
import type { EnvConfig } from "../../config/env.validation.js";

export interface GoogleProfile {
  email: string;
  name: string;
  avatarUrl: string | null;
}

/**
 * Registered unconditionally so Nest DI/module wiring stays static and
 * predictable. When GOOGLE_CLIENT_ID/SECRET are blank (dev default),
 * fallback placeholder values are used so passport-google-oauth20's
 * constructor validation doesn't crash app boot — the controller's
 * /auth/google routes reject with 501 in that case (see auth.controller.ts).
 */
@Injectable()
export class GoogleStrategy extends PassportStrategy(Strategy, "google") {
  constructor(config: ConfigService<EnvConfig, true>) {
    const clientID = config.get("GOOGLE_CLIENT_ID", { infer: true }) || "not-configured";
    const clientSecret = config.get("GOOGLE_CLIENT_SECRET", { infer: true }) || "not-configured";
    const callbackURL =
      config.get("GOOGLE_CALLBACK_URL", { infer: true }) || "http://localhost:3000/api/v1/auth/google/callback";

    super({
      clientID,
      clientSecret,
      callbackURL,
      scope: ["email", "profile"],
    });
  }

  validate(_accessToken: string, _refreshToken: string, profile: Profile, done: VerifyCallback) {
    const email = profile.emails?.[0]?.value;
    if (!email) {
      return done(new Error("Google profile did not return an email address"), undefined);
    }

    const googleProfile: GoogleProfile = {
      email,
      name: profile.displayName || email,
      avatarUrl: profile.photos?.[0]?.value ?? null,
    };

    done(null, googleProfile);
  }
}
