import type { CollectorConfig } from "./config.js";
import { logger } from "./logger.js";
import { postSourceStatus } from "./sink.js";
import type { Market, RetailSource, SourceStatusEvent } from "./types.js";

export interface SourceAttempt {
  source: RetailSource;
  market: Market;
  displayName: string;
  fixture: boolean;
}

export interface SourceAttemptMetrics {
  productsSeen: number;
  queueLag: number;
  duplicatesSkipped?: number;
  antiBotBlocked?: boolean;
  keepaRequests?: number;
  discoverySegmentId?: string | null;
  discoveryYieldCount?: number;
  apifyCostMicros?: number | null;
}

type StatusSender = (
  status: SourceStatusEvent,
  config: {
    baseUrl: string;
    ingestSecret: string;
    sitesAuthToken?: string;
    timeoutMs?: number;
  },
) => Promise<unknown>;

interface ReporterDependencies {
  send?: StatusSender;
  now?: () => Date;
  onError?: (error: unknown, attempt: SourceAttempt) => void;
}

const DISPLAY_NAMES: Record<RetailSource, string> = {
  amazon: "Amazon",
  boulanger: "Boulanger",
  cdiscount: "Cdiscount",
  darty: "Darty",
};

function safeCount(value: number): number {
  return Number.isSafeInteger(value) && value >= 0 ? value : 0;
}

export function sourceAttempt(
  source: RetailSource,
  market: Market,
  fixture: boolean,
): SourceAttempt {
  return {
    source,
    market,
    displayName: source === "amazon" ? `${DISPLAY_NAMES[source]} ${market}` : DISPLAY_NAMES[source],
    fixture,
  };
}

export class SourceStatusReporter {
  readonly #config: CollectorConfig;
  readonly #send: StatusSender;
  readonly #now: () => Date;
  readonly #onError: (error: unknown, attempt: SourceAttempt) => void;
  readonly #lastSuccessBySource = new Map<string, string>();

  constructor(config: CollectorConfig, dependencies: ReporterDependencies = {}) {
    this.#config = config;
    this.#send = dependencies.send ?? postSourceStatus;
    this.#now = dependencies.now ?? (() => new Date());
    this.#onError = dependencies.onError ?? ((error, attempt) => {
      logger.warn("source_status_failed", {
        source: attempt.source,
        market: attempt.market,
        error,
      });
    });
  }

  async healthy(attempt: SourceAttempt, metrics: SourceAttemptMetrics): Promise<boolean> {
    return this.#report(attempt, "healthy", metrics, null);
  }

  async degraded(
    attempt: SourceAttempt,
    metrics: SourceAttemptMetrics,
    errorCode = "COLLECTOR_JOB_FAILED",
  ): Promise<boolean> {
    return this.#report(attempt, "degraded", metrics, errorCode);
  }

  async #report(
    attempt: SourceAttempt,
    status: "healthy" | "degraded",
    metrics: SourceAttemptMetrics,
    errorCode: string | null,
  ): Promise<boolean> {
    if (attempt.fixture || !this.#config.priceRadarBaseUrl || !this.#config.ingestSecret) return false;

    const now = this.#now().toISOString();
    const key = `${attempt.source}:${attempt.market}`;
    if (status === "healthy") this.#lastSuccessBySource.set(key, now);

    try {
      await this.#send({
        source: attempt.source,
        market: attempt.market,
        displayName: attempt.displayName,
        mode: "live",
        status,
        lastSuccessAt: this.#lastSuccessBySource.get(key) ?? null,
        lastAttemptAt: now,
        lastErrorCode: errorCode,
        productsSeen: safeCount(metrics.productsSeen),
        queueLag: safeCount(metrics.queueLag),
        duplicatesSkipped: safeCount(metrics.duplicatesSkipped ?? 0),
        antiBotBlocked: metrics.antiBotBlocked === true,
        keepaRequests: safeCount(metrics.keepaRequests ?? 0),
        discoverySegmentId: metrics.discoverySegmentId ?? null,
        discoveryYieldCount: safeCount(metrics.discoveryYieldCount ?? 0),
        apifyCostMicros: metrics.apifyCostMicros ?? null,
      }, {
        baseUrl: this.#config.priceRadarBaseUrl,
        ingestSecret: this.#config.ingestSecret,
        ...(this.#config.sitesAuthToken ? { sitesAuthToken: this.#config.sitesAuthToken } : {}),
        timeoutMs: this.#config.httpTimeoutMs,
      });
      return true;
    } catch (error) {
      this.#onError(error, attempt);
      return false;
    }
  }
}

export async function runReportedSourceAttempt<T>(options: {
  reporter: SourceStatusReporter;
  attempt: SourceAttempt;
  run: () => Promise<T>;
  productsSeen: (result: T) => number;
  metrics?: (result: T) => Partial<SourceAttemptMetrics>;
  queueLag: () => number | Promise<number>;
}): Promise<T> {
  try {
    const result = await options.run();
    let queueLag = 0;
    try {
      queueLag = await options.queueLag();
    } catch {
      // Metrics must not change the outcome of the source attempt.
    }
    await options.reporter.healthy(options.attempt, {
      ...(options.metrics?.(result) ?? {}),
      productsSeen: options.productsSeen(result),
      queueLag,
    });
    return result;
  } catch (primaryError) {
    let queueLag = 0;
    try {
      queueLag = await options.queueLag();
    } catch {
      // Preserve the original collection error.
    }
    const message = primaryError instanceof Error ? primaryError.message.toLowerCase() : "";
    const antiBotBlocked = /(?:403|429|captcha|blocked|access denied|robot)/u.test(message);
    await options.reporter.degraded(
      options.attempt,
      { productsSeen: 0, queueLag, antiBotBlocked },
      antiBotBlocked ? "ANTI_BOT_BLOCKED" : "COLLECTOR_JOB_FAILED",
    );
    throw primaryError;
  }
}
