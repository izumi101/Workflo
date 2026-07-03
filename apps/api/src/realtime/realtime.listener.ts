import { Injectable, Logger } from "@nestjs/common";
import { OnEvent } from "@nestjs/event-emitter";
import {
  projectRoom,
  REALTIME_EVENTS,
  type IssueDeletedEventPayload,
  type IssueEventPayload,
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
  onIssueCreated(payload: IssueEventPayload): void {
    this.broadcast(REALTIME_EVENTS.ISSUE_CREATED, payload);
  }

  @OnEvent(REALTIME_EVENTS.ISSUE_UPDATED)
  onIssueUpdated(payload: IssueEventPayload): void {
    this.broadcast(REALTIME_EVENTS.ISSUE_UPDATED, payload);
  }

  @OnEvent(REALTIME_EVENTS.ISSUE_MOVED)
  onIssueMoved(payload: IssueEventPayload): void {
    this.broadcast(REALTIME_EVENTS.ISSUE_MOVED, payload);
  }

  @OnEvent(REALTIME_EVENTS.ISSUE_DELETED)
  onIssueDeleted(payload: IssueDeletedEventPayload): void {
    this.logger.debug(`Broadcasting ${REALTIME_EVENTS.ISSUE_DELETED} to ${projectRoom(payload.projectId)}`);
    this.gateway.server.to(projectRoom(payload.projectId)).emit(REALTIME_EVENTS.ISSUE_DELETED, payload);
  }

  private broadcast(event: string, payload: IssueEventPayload): void {
    this.logger.debug(`Broadcasting ${event} to ${projectRoom(payload.projectId)}`);
    this.gateway.server.to(projectRoom(payload.projectId)).emit(event, payload.issue);
  }
}
