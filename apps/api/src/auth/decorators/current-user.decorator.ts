import { createParamDecorator, ExecutionContext } from "@nestjs/common";
import type { AuthUser } from "@workflo/shared";

/**
 * Pulls the authenticated user (attached by JwtStrategy#validate) off the
 * request. Only usable behind JwtAuthGuard.
 */
export const CurrentUser = createParamDecorator((_data: unknown, ctx: ExecutionContext): AuthUser => {
  const request = ctx.switchToHttp().getRequest();
  return request.user;
});
