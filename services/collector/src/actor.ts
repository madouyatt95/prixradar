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
import { deliverObservation } from "./worker.js";
import type { Market, RetailSource } from "./types.js";

interface ActorInput {
  source?: RetailSource | "all";
  market?: Market;
  urls?: Array<string | { url: string }>;
  mode?: "discover" | "verify" | "full" | "fixture";
  notify?: boolean;
  browserFallback?: boolean;
  limit?: number;
}

function inputUrls(value: ActorInput["urls"]): string[] {
  if (!Array.isArray(value)) return [];
  return value.map((entry) => typeof entry === "string" ? entry : entry.url).filter(Boolean);
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
          const observation = await verifySourceUrl(url, {
            ...scanOptions,
            verifyDelayMs: config.verifyDelayMs,
          });
          if (!fixture) {
            await deliverObservation(observation, config, { allowPush: input.notify === true });
          }
          await Actor.pushData({ dataKind: "verified-observation", ...observation });
          return 1;
        },
        productsSeen: (count) => count,
        queueLag: () => 0,
      });
    }

    if ((source === "amazon" || source === "all") && config.keepaApiKey) {
      const market = input.market ?? "FR";
      await runReportedSourceAttempt({
        reporter: statusReporter,
        attempt: sourceAttempt("amazon", market, fixture),
        run: async () => {
          const client = new KeepaClient({
            apiKey: config.keepaApiKey as string,
            timeoutMs: config.httpTimeoutMs,
            maxQuotaWaitMs: config.keepaMaxQuotaWaitMs,
          });
          const observations = await scanKeepaMarket(client, market, { limit, fixture });
          for (const observation of observations) {
            if (!fixture) {
              await deliverObservation(observation, config, { allowPush: input.notify === true });
            }
            await Actor.pushData({ dataKind: "verified-observation", ...observation });
          }
          return observations.length;
        },
        productsSeen: (count) => count,
        queueLag: () => 0,
      });
    }
  } finally {
    await Actor.exit();
  }
}
