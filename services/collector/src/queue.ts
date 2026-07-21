import { Queue, Worker, type ConnectionOptions, type JobsOptions, type Processor } from "bullmq";
import { Redis } from "ioredis";

import { stableHash } from "./normalize.js";
import type { Market } from "./types.js";

export const COLLECTOR_QUEUE = "prixradar-collector-v1";
export const MAX_PAGINATION_DEPTH = 19;

export type CollectorJob =
  | { kind: "discover-source"; url: string; fixture: boolean; paginationDepth?: number }
  | { kind: "verify-source"; url: string; fixture: boolean }
  | { kind: "scan-keepa"; market: Market; fixture: boolean; limit: number };

function redisUrl(raw: string): string {
  const url = new URL(raw);
  if (url.protocol !== "redis:" && url.protocol !== "rediss:") {
    throw new Error("REDIS_URL doit utiliser redis:// ou rediss://.");
  }
  return url.toString();
}

export function createRedisConnection(url: string): Redis {
  return new Redis(redisUrl(url), {
    maxRetriesPerRequest: null,
    enableReadyCheck: true,
    lazyConnect: true,
  });
}

function bullmqConnection(urlValue: string): ConnectionOptions {
  const url = new URL(redisUrl(urlValue));
  const database = url.pathname.length > 1 ? Number(url.pathname.slice(1)) : 0;
  return {
    host: url.hostname,
    port: url.port ? Number(url.port) : 6379,
    db: Number.isSafeInteger(database) && database >= 0 ? database : 0,
    maxRetriesPerRequest: null,
    ...(url.username ? { username: decodeURIComponent(url.username) } : {}),
    ...(url.password ? { password: decodeURIComponent(url.password) } : {}),
    ...(url.protocol === "rediss:" ? { tls: {} } : {}),
  };
}

function optionsFor(job: CollectorJob): JobsOptions {
  const deduplicationId = stableHash([job.kind, "url" in job ? job.url : job.market, job.fixture]);
  return {
    priority: job.kind === "verify-source" ? 1 : job.kind === "scan-keepa" ? 5 : 10,
    attempts: job.kind === "verify-source" ? 5 : 3,
    backoff: { type: "exponential", delay: 5_000 },
    removeOnComplete: { age: 86_400, count: 10_000 },
    removeOnFail: { age: 604_800, count: 5_000 },
    deduplication: { id: deduplicationId, ttl: job.kind === "verify-source" ? 60_000 : 300_000 },
  };
}

export class CollectorQueue {
  readonly queue: Queue;

  constructor(redisUrlValue: string) {
    this.queue = new Queue(COLLECTOR_QUEUE, {
      connection: bullmqConnection(redisUrlValue),
      defaultJobOptions: { attempts: 3, backoff: { type: "exponential", delay: 5_000 } },
    });
  }

  async add(job: CollectorJob): Promise<string> {
    const queued = await this.queue.add(job.kind, job, optionsFor(job));
    return String(queued.id);
  }

  async close(): Promise<void> {
    await this.queue.close();
  }
}

export function createCollectorWorker(
  redisUrlValue: string,
  processor: Processor<CollectorJob>,
): { worker: Worker<CollectorJob> } {
  const worker = new Worker<CollectorJob>(COLLECTOR_QUEUE, processor, {
    connection: bullmqConnection(redisUrlValue),
    concurrency: 4,
    limiter: { max: 20, duration: 60_000 },
  });
  return { worker };
}
