import {
  BadRequestException,
  type ArgumentMetadata,
  type PipeTransform,
} from "@nestjs/common";
import type { ZodSchema } from "zod";

/**
 * Validates a request body against a shared Zod schema (ADR-0004 — shared
 * schemas in packages/shared are the single source of truth for request
 * contracts; we validate against them directly instead of duplicating shapes
 * with class-validator DTOs).
 *
 * Bind it to the parameter it should guard, e.g.
 * `@Body(new ZodValidationPipe(registerSchema)) body: Register`. As a safety
 * net it only runs on `body` params, so it can never silently become a no-op
 * if applied more broadly.
 */
export class ZodValidationPipe implements PipeTransform {
  constructor(private readonly schema: ZodSchema) {}

  transform(value: unknown, metadata?: ArgumentMetadata) {
    // Only validate the request body; leave other arg types (param/query/etc.)
    // untouched.
    if (metadata && metadata.type !== "body") {
      return value;
    }

    const result = this.schema.safeParse(value);
    if (!result.success) {
      throw new BadRequestException({
        message: "Validation failed",
        issues: result.error.issues.map((issue) => ({
          path: issue.path.join("."),
          message: issue.message,
        })),
      });
    }
    return result.data;
  }
}
