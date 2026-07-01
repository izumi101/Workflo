import { z } from "zod";

/**
 * Enum schemas mirrored from the Prisma data model (see docs/architecture.md §3).
 * These are the single source of truth for FE/BE — do not redefine these
 * value sets anywhere else.
 */

export const issueTypeSchema = z.enum(["TASK", "BUG", "EPIC"]);
export type IssueType = z.infer<typeof issueTypeSchema>;

export const issueStatusSchema = z.enum(["TODO", "IN_PROGRESS", "DONE"]);
export type IssueStatus = z.infer<typeof issueStatusSchema>;

export const prioritySchema = z.enum(["LOW", "MEDIUM", "HIGH", "URGENT"]);
export type Priority = z.infer<typeof prioritySchema>;

export const roleSchema = z.enum(["OWNER", "MEMBER"]);
export type Role = z.infer<typeof roleSchema>;
