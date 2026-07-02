import { ExecutionContext, Injectable, NotImplementedException } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { AuthGuard } from "@nestjs/passport";
import type { EnvConfig } from "../../config/env.validation.js";

/**
 * Wraps AuthGuard('google') with an upfront config check so that hitting
 * /auth/google[/callback] without real Google credentials returns a clean
 * 501 instead of Passport attempting to redirect using placeholder
 * ("not-configured") OAuth client credentials.
 */
@Injectable()
export class GoogleAuthGuard extends AuthGuard("google") {
  constructor(private readonly config: ConfigService<EnvConfig, true>) {
    super();
  }

  canActivate(context: ExecutionContext) {
    const clientId = this.config.get("GOOGLE_CLIENT_ID", { infer: true });
    const clientSecret = this.config.get("GOOGLE_CLIENT_SECRET", { infer: true });

    if (!clientId || !clientSecret) {
      throw new NotImplementedException("Google OAuth is not configured on this server");
    }

    return super.canActivate(context);
  }
}
