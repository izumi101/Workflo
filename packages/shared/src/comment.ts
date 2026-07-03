import { z } from "zod";
import { authUserSchema } from "./auth.js";

/**
 * Comment schema — mirrors the `Comment` Prisma model
 * (docs/architecture.md §3). `mentions` is a deduped list of userIds the
 * server has validated as workspace members at write time; it drives
 * notifications later (roadmap 0.4) but carries no behavior itself here.
 */
export const commentSchema = z.object({
  id: z.string().cuid(),
  issueId: z.string().cuid(),
  authorId: z.string().cuid(),
  body: z.string().min(1).max(10_000),
  mentions: z.array(z.string().cuid()).default([]),
  createdAt: z.coerce.date(),
  updatedAt: z.coerce.date(),
});
export type Comment = z.infer<typeof commentSchema>;

/** Author summary embedded in list/create REST responses — never passwordHash. */
export const commentAuthorSchema = authUserSchema.pick({ id: true, name: true, avatarUrl: true });
export type CommentAuthor = z.infer<typeof commentAuthorSchema>;

/** Comment + embedded author summary, as returned by the list/create REST endpoints. */
export const commentWithAuthorSchema = commentSchema.extend({
  author: commentAuthorSchema,
});
export type CommentWithAuthor = z.infer<typeof commentWithAuthorSchema>;

/**
 * `mentionUserIds` are explicit userIds picked by the client's mention
 * picker — the server never parses `@name` strings out of `body`. Each id
 * is validated as a member of the issue's workspace (400 listing offenders)
 * and deduped before being stored in `Comment.mentions`.
 */
export const createCommentSchema = z.object({
  body: z.string().min(1).max(10_000),
  mentionUserIds: z.array(z.string().cuid()).optional(),
});
export type CreateComment = z.infer<typeof createCommentSchema>;

export const updateCommentSchema = z.object({
  body: z.string().min(1).max(10_000),
  mentionUserIds: z.array(z.string().cuid()).optional(),
});
export type UpdateComment = z.infer<typeof updateCommentSchema>;

export const commentListQuerySchema = z.object({
  cursor: z.string().optional(),
  limit: z.coerce.number().int().positive().max(100).default(50),
});
export type CommentListQuery = z.infer<typeof commentListQuerySchema>;
