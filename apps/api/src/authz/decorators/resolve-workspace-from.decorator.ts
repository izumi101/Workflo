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
 *
 * Defaults to "param:id" (workspace routes like GET/PATCH/DELETE /workspaces/:id)
 * when no metadata is set.
 */
export type WorkspaceResolutionStrategy =
  | "param:workspaceId"
  | "param:id"
  | "body:workspaceId"
  | "query:workspaceId"
  | "project:id";

export const ResolveWorkspaceFrom = (strategy: WorkspaceResolutionStrategy) =>
  SetMetadata(RESOLVE_WORKSPACE_FROM_KEY, strategy);
