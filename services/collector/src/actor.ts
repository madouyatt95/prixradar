import { Actor } from "apify";

import { connectorForUrl } from "./connectors/index.js";
import { scanSourceUrl, verifySourceUrl } from "./crawler.js";
import type { CollectorConfig } from "./config.js";
import { KeepaClient, scanKeepaMarket } from "./keepa.js";
import {
  runReportedSourceAttempt,
  sourceAttempt,
  SourceStatusReporter,
} from "./source-status.js";
import { deliverObservation, liveVerifyKeepaObservation } from "./worker.js";
import type { Market, RetailSource } from "./types.js";

interface ActorInput {
  source?: RetailSource | "all";
  market?: Market;
  markets?: Market[];
  urls?: Array<string | { url: string }>;
  mode?: "discover" | "verify" | "full" | "fixture";
  notify?: boolean;
  browserFallback?: boolean;
  limit?: number;
  page?: number;
  minimumDropPercent?: number;
  verifyAmazonPage?: boolean;
  liveVerificationLimit?: number;
}

function inputUrls(value: ActorInput["urls"]): string[] {
  if (!Array.isArray(value)) return [];
  return value.map((entry) => typeof entry === "string" ? entry : entry.url).filter(Boolean);
}

function inputMarkets(input: ActorInput): Market[] {
  const supported = new Set<Market>(["FR", "DE", "IT", "ES", "GB"]);
  const requested = Array.isArray(input.markets) ? input.markets : [input.market ?? "FR"];
  const normalized = requested
    .map((entry) => String(entry).trim().toUpperCase())
    .filter((entry): entry is Market => supported.has(entry as Market));
  return [...new Set(normalized.length > 0 ? normalized : ["FR"] as Market[])];
}

export async function runActor(config: CollectorConfig): Promise<void> {
  await Actor.init();
  try {
    const statusReporter = new SourceStatusReporter(config);
    const input = (await Actor.getInput<ActorInput>()) ?? {};
    const mode = input.mode ?? "full";
    const fixture = mode === "fixture";
    if (fixture && input.notify) {
      throw new Error("notify=true est interdit en mode fixture.");
    }
    const limit = Math.max(1, Math.min(100, Number.isSafeInteger(input.limit) ? input.limit ?? 25 : 25));
    const page = Math.max(0, Math.min(10, Number.isSafeInteger(input.page) ? input.page ?? 0 : 0));
    const minimumDropPercent = Math.max(20, Math.min(90, Number.isFinite(input.minimumDropPercent)
      ? input.minimumDropPercent ?? 30
      : 30));
    const liveVerificationLimit = Math.max(0, Math.min(20, Number.isSafeInteger(input.liveVerificationLimit)
      ? input.liveVerificationLimit ?? 5
      : 5));
    const scanOptions = {
      browserFallback: input.browserFallback ?? config.browserFallback,
      fixture,
      timeoutMs: config.httpTimeoutMs,
      maxDiscoveredUrls: Math.min(limit, config.maxDiscoveredUrls),
      proxyUrls: config.proxyUrls,
    };

    const source = input.source ?? "all";
    const urls = inputUrls(input.urls);
    for (const url of urls) {
      const connector = connectorForUrl(url);
      if (source !== "all" && source !== connector.source) {
        throw new Error(`L’URL ne correspond pas à la source ${source}.`);
      }
      await runReportedSourceAttempt({
        reporter: statusReporter,
        attempt: sourceAttempt(connector.source, connector.market, fixture),
        run: async () => {
          if (mode === "discover") {
            const result = await scanSourceUrl(url, scanOptions);
            await Actor.pushData({ dataKind: "discovery", fixture, ...result });
            return result.discoveredUrls.length;
          }
          const initialScan = mode === "full" ? await scanSourceUrl(url, scanOptions) : null;
          const targetUrls = initialScan
            ? (initialScan.offers.length > 0 ? [url] : initialScan.discoveredUrls.slice(0, limit))
            : [url];
          const targets = targetUrls.length > 0 ? targetUrls : [url];
          for (const targetUrl of targets) {
            const observation = await verifySourceUrl(targetUrl, {
              ...scanOptions,
              verifyDelayMs: config.verifyDelayMs,
            });
            if (!fixture) {
              await deliverObservation(observation, config, { allowPush: input.notify === true });
            }
            await Actor.pushData({ dataKind: "verified-observation", ...observation });
          }
          return targets.length;
        },
        productsSeen: (count) => count,
        queueLag: () => 0,
      });
    }

    if ((source === "amazon" || source === "all") && config.keepaApiKey) {
      for (const market of inputMarkets(input)) {
        await runReportedSourceAttempt({
          reporter: statusReporter,
          attempt: sourceAttempt("amazon", market, fixture),
          run: async () => {
          const client = new KeepaClient({
            apiKey: config.keepaApiKey as string,
            timeoutMs: config.httpTimeoutMs,
            maxQuotaWaitMs: config.keepaMaxQuotaWaitMs,
          });
          const observations = await scanKeepaMarket(client, market, {
            limit,
            page,
            minimumDropPercent,
            fixture,
          });
          for (const [index, observation] of observations.entries()) {
            const live = input.verifyAmazonPage !== false && index < liveVerificationLimit
              ? await liveVerifyKeepaObservation(observation, config, {
                  browserFallback: input.browserFallback ?? config.browserFallback,
                })
              : { observation, liveVerified: false, errorCode: "AMAZON_LIVE_SKIPPED" };
            if (!fixture) {
              await deliverObservation(live.observation, config, { allowPush: input.notify === true });
            }
            await Actor.pushData({
              dataKind: "verified-observation",
              liveVerified: live.liveVerified,
              liveVerificationErrorCode: live.errorCode,
              ...live.observation,
            });
          }
            return observations.length;
          },
          productsSeen: (count) => count,
          queueLag: () => 0,
        });
      }
    }
  } finally {
    await Actor.exit();
  }
}
