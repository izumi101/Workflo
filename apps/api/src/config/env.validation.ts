import { z } from "zod";

/**
 * Environment schema validated once at boot (fail fast). Extend this as new
 * env vars are introduced — never read `process.env` directly elsewhere.
 */
export const envSchema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  PORT: z.coerce.number().int().positive().default(3000),

  DATABASE_URL: z.string().min(1, "DATABASE_URL is required"),
  REDIS_URL: z.string().min(1, "REDIS_URL is required"),

  JWT_ACCESS_SECRET: z.string().min(1, "JWT_ACCESS_SECRET is required"),
  JWT_REFRESH_SECRET: z.string().min(1, "JWT_REFRESH_SECRET is required"),
  JWT_ACCESS_TTL: z.string().default("15m"),
  JWT_REFRESH_TTL: z.string().default("7d"),

  GOOGLE_CLIENT_ID: z.string().optional().default(""),
  GOOGLE_CLIENT_SECRET: z.string().optional().default(""),
  GOOGLE_CALLBACK_URL: z.string().optional().default(""),

  WEB_ORIGIN: z.string().min(1, "WEB_ORIGIN is required"),
});

export type EnvConfig = z.infer<typeof envSchema>;

/** Passed to ConfigModule.forRoot({ validate }) — throws (fails fast) on invalid env. */
export function validateEnv(config: Record<string, unknown>): EnvConfig {
  const parsed = envSchema.safeParse(config);
  if (!parsed.success) {
    const message = parsed.error.issues
      .map((issue) => `  - ${issue.path.join(".")}: ${issue.message}`)
      .join("\n");
    throw new Error(`Invalid environment configuration:\n${message}`);
  }
  return parsed.data;
}
