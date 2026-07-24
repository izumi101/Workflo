import { SetMetadata } from "@nestjs/common";

export const RESOLVE_WORKSPACE_FROM_KEY = "workflo:resolveWorkspaceFrom";

/**
 * Tells WorkspaceMemberGuard how to find the target workspace id for this
 * route:
 *  - "param:workspaceId" / "param:id" — read `req.params[<name>]` directly
 *    as the workspace id.
 *  - "body:workspaceId" / "query:workspaceId" — read the workspace id off
 *    the request body/query (e.g. POST /projects, GET /projects?workspaceId=).
 *  - "project:id" — read `req.params.id` as a PROJECT id, look the project
 *    up, and use its workspaceId (e.g. GET/PATCH/DELETE /projects/:id).
 *  - "issue:key" — read `req.params.key` as a human issue key ("WF-123"),
 *    parse it, look up the project by key + the issue by number, and use its
 *    workspaceId (e.g. GET/PATCH/DELETE /issues/:key).
 *  - "label:id" — read `req.params.id` as a LABEL id, look the label up via
 *    its project, and use the project's workspaceId (e.g. DELETE /labels/:id).
 *  - "comment:id" — read `req.params.id` as a COMMENT id, look it up via its
 *    issue -> project, and use the project's workspaceId (e.g.
 *    PATCH/DELETE /comments/:id). 404s on an unknown comment.
 *  - "view:id" — read `req.params.id` as a VIEW id, look it up directly, and
 *    use its own workspaceId (e.g. PATCH/DELETE /views/:id). 404s on an
 *    unknown view.
 *  - "issue:body-id" — read `req.body.issueId` as an ISSUE id (NOT a human
 *    key — a raw cuid, unlike "issue:key"), look it up via its project, and
 *    use the project's workspaceId (e.g. POST /triage/dismiss, where the
 *    issue id travels in the body alongside the section, not as a route
 *    param). 404s ("Issue not found") on an unknown id.
 *
 * Defaults to "param:id" (workspace routes like GET/PATCH/DELETE /workspaces/:id)
 * when no metadata is set.
 */
export type WorkspaceResolutionStrategy =
  | "param:workspaceId"
  | "param:id"
  | "body:workspaceId"
  | "query:workspaceId"
  | "project:id"
  | "issue:key"
  | "label:id"
  | "comment:id"
  | "view:id"
  | "issue:body-id";

export const ResolveWorkspaceFrom = (strategy: WorkspaceResolutionStrategy) =>
  SetMetadata(RESOLVE_WORKSPACE_FROM_KEY, strategy);
