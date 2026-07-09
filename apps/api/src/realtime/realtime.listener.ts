import { Injectable, Logger } from "@nestjs/common";
import { OnEvent } from "@nestjs/event-emitter";
import {
  projectRoom,
  REALTIME_EVENTS,
  type CommentDeletedEventPayload,
  type CommentEventPayload,
  type Issue,
  type IssueDeletedEventPayload,
} from "@workflo/shared";
import { RealtimeGateway } from "./realtime.gateway.js";

/**
 * Bridges the internal NestJS event bus (docs/architecture.md §2.3) to the
 * Socket.IO room broadcast. IssuesService emits domain events AFTER the DB
 * commit; this listener is the only consumer that turns them into `project:{id}`
 * room broadcasts. Broadcasts to the WHOLE room (originator included) —
 * client-side handlers are idempotent, so the echo is harmless.
 */
@Injectable()
export class RealtimeListener {
  private readonly logger = new Logger(RealtimeListener.name);

  constructor(private readonly gateway: RealtimeGateway) {}

  @OnEvent(REALTIME_EVENTS.ISSUE_CREATED)
  onIssueCreated(issue: Issue): void {
    this.broadcast(REALTIME_EVENTS.ISSUE_CREATED, issue);
  }

  @OnEvent(REALTIME_EVENTS.ISSUE_UPDATED)
  onIssueUpdated(issue: Issue): void {
    this.broadcast(REALTIME_EVENTS.ISSUE_UPDATED, issue);
  }

  @OnEvent(REALTIME_EVENTS.ISSUE_MOVED)
  onIssueMoved(issue: Issue): void {
    this.broadcast(REALTIME_EVENTS.ISSUE_MOVED, issue);
  }

  @OnEvent(REALTIME_EVENTS.ISSUE_DELETED)
  onIssueDeleted(payload: IssueDeletedEventPayload): void {
    this.logger.debug(`Broadcasting ${REALTIME_EVENTS.ISSUE_DELETED} to ${projectRoom(payload.projectId)}`);
    this.gateway.server.to(projectRoom(payload.projectId)).emit(REALTIME_EVENTS.ISSUE_DELETED, payload);
  }

  @OnEvent(REALTIME_EVENTS.COMMENT_ADDED)
  onCommentAdded(payload: CommentEventPayload): void {
    this.broadcastComment(REALTIME_EVENTS.COMMENT_ADDED, payload);
  }

  @OnEvent(REALTIME_EVENTS.COMMENT_UPDATED)
  onCommentUpdated(payload: CommentEventPayload): void {
    this.broadcastComment(REALTIME_EVENTS.COMMENT_UPDATED, payload);
  }

  @OnEvent(REALTIME_EVENTS.COMMENT_DELETED)
  onCommentDeleted(payload: CommentDeletedEventPayload): void {
    this.logger.debug(`Broadcasting ${REALTIME_EVENTS.COMMENT_DELETED} to ${projectRoom(payload.projectId)}`);
    this.gateway.server.to(projectRoom(payload.projectId)).emit(REALTIME_EVENTS.COMMENT_DELETED, payload);
  }

  /** issue.created/updated/moved emit the exact IssueEventPayload (bare Issue) shape — see packages/shared/src/realtime.ts. */
  private broadcast(event: string, issue: Issue): void {
    this.logger.debug(`Broadcasting ${event} to ${projectRoom(issue.projectId)}`);
    this.gateway.server.to(projectRoom(issue.projectId)).emit(event, issue);
  }

  /** comment.added/comment.updated emit the exact CommentEventPayload shape (see packages/shared/src/realtime.ts). */
  private broadcastComment(event: string, payload: CommentEventPayload): void {
    this.logger.debug(`Broadcasting ${event} to ${projectRoom(payload.projectId)}`);
    this.gateway.server.to(projectRoom(payload.projectId)).emit(event, payload);
  }
}
