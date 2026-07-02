import { z } from "zod";

/**
 * Auth request/response contracts (ADR-0004, ADR-0005). These are the single
 * source of truth for FE/BE — the API validates request bodies against these
 * schemas and the response shapes must match `AuthUser` / `AuthResponse`
 * exactly. `passwordHash` must NEVER appear in any schema here.
 */

export const registerSchema = z.object({
  email: z.string().email(),
  password: z.string().min(8).max(100),
  name: z.string().min(1).max(120),
});
export type Register = z.infer<typeof registerSchema>;

export const loginSchema = z.object({
  email: z.string().email(),
  password: z.string().min(1),
});
export type Login = z.infer<typeof loginSchema>;

export const authUserSchema = z.object({
  id: z.string().cuid(),
  email: z.string().email(),
  name: z.string(),
  avatarUrl: z.string().nullable().optional(),
});
export type AuthUser = z.infer<typeof authUserSchema>;

export const authResponseSchema = z.object({
  accessToken: z.string(),
  user: authUserSchema,
});
export type AuthResponse = z.infer<typeof authResponseSchema>;
