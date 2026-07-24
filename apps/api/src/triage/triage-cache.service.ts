import { Injectable, Logger, type OnModuleDestroy } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import Redis from "ioredis";
import type { TriageResponse } from "@workflo/shared";
import type { EnvConfig } from "../config/env.validation.js";

/**
 * Small dedicated `ioredis` client for the triage 60s cache (docs/design/
 * nlq-search.md §2.7/§3.4) — mirrors `realtime/redis-io.adapter.ts`'s
 * `new Redis(redisUrl)` pattern rather than sharing a client with BullMQ's
 * queue connection or the Socket.IO adapter's pub/sub pair (those are
 * owned by other modules for their own lifecycles).
 *
 * Fail-open in every method (§3.4 "Redis down -> skip caches, still works"):
 * any Redis error is caught and treated as a cache miss / no-op rather than
 * propagated, so a Redis outage degrades triage to "always recompute", never
 * a 500.
 */
@Injectable()
export class TriageCacheService implements OnModuleDestroy {
  private readonly logger = new Logger(TriageCacheService.name);
  private readonly client: Redis;

  constructor(config: ConfigService<EnvConfig, true>) {
    const redisUrl = config.get("REDIS_URL", { infer: true });
    this.client = new Redis(redisUrl, { lazyConnect: false, maxRetriesPerRequest: 1 });
    this.client.on("error", (err) => {
      // ioredis requires an 'error' listener or it throws unhandled errors;
      // logging here is enough — every call site already fails open.
      this.logger.warn(`Triage cache Redis error: ${err.message}`);
    });
  }

  /** Single place the `triage:{workspaceId}:{userId}` key format is defined — `delByWorkspace`'s scan pattern derives from this same prefix so the two can never drift apart. */
  private static workspacePrefix(workspaceId: string): string {
    return `triage:${workspaceId}:`;
  }

  static cacheKey(workspaceId: string, userId: string): string {
    return `${TriageCacheService.workspacePrefix(workspaceId)}${userId}`;
  }

  async get(key: string): Promise<TriageResponse | null> {
    try {
      const raw = await this.client.get(key);
      if (!raw) return null;
      return JSON.parse(raw) as TriageResponse;
    } catch (err) {
      this.logger.warn(`Triage cache GET failed for ${key}: ${(err as Error).message}`);
      return null;
    }
  }

  async set(key: string, value: TriageResponse, ttlSeconds: number): Promise<void> {
    try {
      await this.client.set(key, JSON.stringify(value), "EX", ttlSeconds);
    } catch (err) {
      this.logger.warn(`Triage cache SET failed for ${key}: ${(err as Error).message}`);
    }
  }

  async del(key: string): Promise<void> {
    try {
      await this.client.del(key);
    } catch (err) {
      this.logger.warn(`Triage cache DEL failed for ${key}: ${(err as Error).message}`);
    }
  }

  /**
   * Invalidates EVERY user's cached triage for `workspaceId` (not just one
   * user's key) — used by `TriageCacheListener` when an issue mutation
   * anywhere in the app changes what triage should show, since that can
   * affect every workspace member's view (e.g. an assignment pulls a row out
   * of UNOWNED_URGENT for everyone, not just the acting user). Uses
   * `scanStream` rather than `KEYS` (which blocks the whole Redis server) to
   * enumerate matching keys before deleting them. Fail-open like every other
   * method here.
   */
  async delByWorkspace(workspaceId: string): Promise<void> {
    try {
      const pattern = `${TriageCacheService.workspacePrefix(workspaceId)}*`;
      const keys = await this.scanKeys(pattern);
      if (keys.length > 0) {
        await this.client.del(...keys);
      }
    } catch (err) {
      this.logger.warn(`Triage cache delByWorkspace failed for workspace ${workspaceId}: ${(err as Error).message}`);
    }
  }

  private scanKeys(pattern: string): Promise<string[]> {
    return new Promise((resolve, reject) => {
      const keys: string[] = [];
      const stream = this.client.scanStream({ match: pattern, count: 100 });
      stream.on("data", (resultKeys: string[]) => {
        keys.push(...resultKeys);
      });
      stream.on("end", () => resolve(keys));
      stream.on("error", (err) => reject(err));
    });
  }

  async onModuleDestroy(): Promise<void> {
    await this.client.quit();
  }
}
