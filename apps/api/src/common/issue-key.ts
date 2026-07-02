import { BadRequestException } from "@nestjs/common";

/** Parsed human-readable issue key, e.g. "WF-123" -> { projectKey: "WF", number: 123 }. */
export interface ParsedIssueKey {
  projectKey: string;
  number: number;
}

const ISSUE_KEY_PATTERN = /^([A-Z][A-Z0-9]*)-(\d+)$/;

/**
 * Parses a human-readable issue key ("WF-123") into its project key and
 * issue number. Throws 400 on malformed input (e.g. missing dash, non-numeric
 * suffix) — callers still need a separate 404 for "well-formed but doesn't
 * exist".
 */
export function parseIssueKey(key: string): ParsedIssueKey {
  const match = ISSUE_KEY_PATTERN.exec(key);
  if (!match) {
    throw new BadRequestException(`Invalid issue key: "${key}"`);
  }
  const [, projectKey, numberStr] = match;
  return { projectKey: projectKey!, number: Number.parseInt(numberStr!, 10) };
}
