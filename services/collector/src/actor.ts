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
import { sendDailyDigests } from "./push.js";
import { postFrontierItems, privateApiHeaders } from "./sink.js";
import type { Market, RetailSource } from "./types.js";

interface ActorInput {
  source?: RetailSource | "all";
  market?: Market;
  markets?: Market[];
  urls?: Array<string | { url: string }>;
  mode?: "discover" | "verify" | "full" | "fixture" | "digest";
  notify?: boolean;
  browserFallback?: boolean;
  limit?: number;
  page?: number;
  minimumDropPercent?: number;
  verifyAmazonPage?: boolean;
  liveVerificationLimit?: number;
  useRemoteCoverage?: boolean;
  useRemoteDiscovery?: boolean;
  scanAmazon?: boolean;
  shadowCart?: boolean;
}

type RemoteDiscoverySegment = {
  id: string;
  market: Market;
  label: string;
  categoryIds: number[];
  minPriceCents: number;
  maxPriceCents: number;
  minimumDropPercent: number;
  limit: number;
  page: number;
};

type RemoteRecheck = { id: string; alertId: string; source: RetailSource; market: Market; url: string };
type RemotePriority = { id: string; source: RetailSource; market: Market; url: string; kind: "inspection" | "frontier"; shadowCart: boolean };
type RemotePlan = { urls: string[]; discoverySegments: RemoteDiscoverySegment[]; rechecks: RemoteRecheck[]; priorityTasks: RemotePriority[] };

function priorityItems(value: unknown, kind: RemotePriority["kind"]): RemotePriority[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((candidate): RemotePriority[] => {
    if (!candidate || typeof candidate !== "object") return [];
    const item = candidate as Record<string, unknown>;
    const source = String(item.source ?? "") as RetailSource;
    const market = String(item.market ?? "") as Market;
    const url = String(item.url ?? "");
    if (!["amazon", "boulanger", "darty", "cdiscount"].includes(source) || !["FR", "DE", "IT", "ES", "GB"].includes(market)) return [];
    try { connectorForUrl(url); } catch { return []; }
    return [{ id: String(item.id ?? ""), source, market, url, kind, shadowCart: item.shadowCart !== false }];
  });
}

async function remotePlan(config: CollectorConfig): Promise<RemotePlan> {
  if (!config.priceRadarBaseUrl || !config.ingestSecret) return { urls: [], discoverySegments: [], rechecks: [], priorityTasks: [] };
  const endpoint = new URL("api/source-plan", config.priceRadarBaseUrl.endsWith("/") ? config.priceRadarBaseUrl : `${config.priceRadarBaseUrl}/`);
  const response = await fetch(endpoint, {
    headers: privateApiHeaders({
      secret: config.ingestSecret,
      ...(config.sitesAuthToken ? { sitesAuthToken: config.sitesAuthToken } : {}),
    }),
    signal: AbortSignal.timeout(config.httpTimeoutMs),
  });
  if (!response.ok) throw new Error(`Plan de couverture indisponible (HTTP ${response.status}).`);
  const payload = await response.json() as {
    items?: Array<{ discoveryUrl?: unknown }>;
    discoverySegments?: unknown;
    rechecks?: unknown;
    inspections?: unknown;
    frontier?: unknown;
  };
  const segments = Array.isArray(payload.discoverySegments)
    ? payload.discoverySegments.flatMap((candidate): RemoteDiscoverySegment[] => {
        if (!candidate || typeof candidate !== "object") return [];
        const value = candidate as Record<string, unknown>;
        const market = String(value.market ?? "").toUpperCase() as Market;
        if (!["FR", "DE", "IT", "ES", "GB"].includes(market)) return [];
        const categoryIds = Array.isArray(value.categoryIds)
          ? value.categoryIds.filter((item): item is number => Number.isSafeInteger(item) && Number(item) > 0).slice(0, 20)
          : [];
        const number = (field: string, fallback: number) => Number.isSafeInteger(value[field]) ? Number(value[field]) : fallback;
        return [{
          id: String(value.id ?? `${market}:default`),
          market,
          label: String(value.label ?? "Découverte"),
          categoryIds,
          minPriceCents: Math.max(1, number("minPriceCents", 1)),
          maxPriceCents: Math.max(1, number("maxPriceCents", 100_000_000)),
          minimumDropPercent: Math.max(20, Math.min(90, number("minimumDropPercent", 30))),
          limit: Math.max(1, Math.min(100, number("limit", 10))),
          page: Math.max(0, Math.min(10, number("page", 0))),
        }];
      })
    : [];
  return {
    urls: (payload.items ?? []).flatMap((item) => typeof item.discoveryUrl === "string" ? [item.discoveryUrl] : []),
    discoverySegments: segments,
    rechecks: Array.isArray(payload.rechecks) ? payload.rechecks.flatMap((candidate): RemoteRecheck[] => {
      if (!candidate || typeof candidate !== "object") return [];
      const value = candidate as Record<string, unknown>;
      const source = String(value.source ?? "") as RetailSource;
      const market = String(value.market ?? "") as Market;
      const url = String(value.url ?? "");
      if (!["amazon", "boulanger", "darty", "cdiscount"].includes(source) || !["FR", "DE", "IT", "ES", "GB"].includes(market)) return [];
      try { if (new URL(url).protocol !== "https:") return []; } catch { return []; }
      return [{ id: String(value.id ?? ""), alertId: String(value.alertId ?? ""), source, market, url }];
    }) : [],
    priorityTasks: [
      ...priorityItems(payload.inspections, "inspection"),
      ...priorityItems(payload.frontier, "frontier"),
    ],
  };
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
    if (mode === "digest") {
      if (!config.priceRadarBaseUrl || !config.pushDeliverySecret || !config.vapidSubject || !config.vapidPublicKey || !config.vapidPrivateKey) {
        throw new Error("Configuration push incomplète pour le résumé quotidien.");
      }
      const summary = await sendDailyDigests({
        baseUrl: config.priceRadarBaseUrl,
        deliverySecret: config.pushDeliverySecret,
        ...(config.sitesAuthToken ? { sitesAuthToken: config.sitesAuthToken } : {}),
        vapidSubject: config.vapidSubject,
        vapidPublicKey: config.vapidPublicKey,
        vapidPrivateKey: config.vapidPrivateKey,
        timeoutMs: config.httpTimeoutMs,
      });
      await Actor.pushData({ dataKind: "daily-digest", ...summary });
      return;
    }
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
    const configuredUrls = inputUrls(input.urls);
    const usesRemotePlan = (configuredUrls.length === 0 && input.useRemoteCoverage !== false)
      || input.useRemoteDiscovery === true;
    const plan = usesRemotePlan ? await remotePlan(config) : { urls: [], discoverySegments: [], rechecks: [], priorityTasks: [] };
    const urls = [...new Set(configuredUrls.length > 0 || input.useRemoteCoverage === false
      ? configuredUrls
      : plan.urls)];
    const seenProductUrls = new Set<string>();
    for (const task of plan.priorityTasks) {
      if (seenProductUrls.has(task.url)) continue;
      const observation = await verifySourceUrl(task.url, {
        ...scanOptions,
        shadowCart: task.shadowCart,
        verifyDelayMs: config.verifyDelayMs,
      });
      if (!fixture) await deliverObservation(observation, config, { allowPush: task.kind === "inspection" && input.notify === true });
      seenProductUrls.add(task.url);
      await Actor.pushData({ dataKind: `autonomous-${task.kind}`, requestId: task.id, ...observation });
    }
    for (const recheck of plan.rechecks) {
      const observation = await verifySourceUrl(recheck.url, {
        ...scanOptions,
        verifyDelayMs: config.verifyDelayMs,
        shadowCart: input.shadowCart ?? true,
      });
      if (!fixture) await deliverObservation(observation, config, { allowPush: false });
      seenProductUrls.add(recheck.url);
      await Actor.pushData({ dataKind: "on-demand-recheck", requestId: recheck.id, alertId: recheck.alertId, ...observation });
    }
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
            if (!fixture && config.priceRadarBaseUrl && config.ingestSecret) {
              await postFrontierItems(result.discoveredUrls.map((productUrl) => ({ url: productUrl, discoveredFrom: result.loadedUrl, depth: 1 })), {
                baseUrl: config.priceRadarBaseUrl,
                ingestSecret: config.ingestSecret,
                ...(config.sitesAuthToken ? { sitesAuthToken: config.sitesAuthToken } : {}),
                timeoutMs: config.httpTimeoutMs,
              });
            }
            const unseen = result.discoveredUrls.filter((productUrl) => !seenProductUrls.has(productUrl));
            unseen.forEach((productUrl) => seenProductUrls.add(productUrl));
            return { productsSeen: unseen.length, duplicatesSkipped: result.discoveredUrls.length - unseen.length };
          }
          const initialScan = mode === "full" ? await scanSourceUrl(url, scanOptions) : null;
          if (initialScan && !fixture && config.priceRadarBaseUrl && config.ingestSecret && initialScan.discoveredUrls.length > 0) {
            await postFrontierItems(initialScan.discoveredUrls.map((productUrl) => ({ url: productUrl, discoveredFrom: initialScan.loadedUrl, depth: 1 })), {
              baseUrl: config.priceRadarBaseUrl,
              ingestSecret: config.ingestSecret,
              ...(config.sitesAuthToken ? { sitesAuthToken: config.sitesAuthToken } : {}),
              timeoutMs: config.httpTimeoutMs,
            });
          }
          const targetUrls = initialScan
            ? (initialScan.offers.length > 0 ? [url] : initialScan.discoveredUrls.slice(0, limit))
            : [url];
          const candidates = targetUrls.length > 0 ? targetUrls : [url];
          const targets = candidates.filter((targetUrl) => {
            if (seenProductUrls.has(targetUrl)) return false;
            seenProductUrls.add(targetUrl);
            return true;
          });
          for (const targetUrl of targets) {
            const observation = await verifySourceUrl(targetUrl, {
              ...scanOptions,
              verifyDelayMs: config.verifyDelayMs,
              shadowCart: input.shadowCart ?? mode === "verify",
            });
            if (!fixture) {
              await deliverObservation(observation, config, { allowPush: input.notify === true });
            }
            await Actor.pushData({ dataKind: "verified-observation", ...observation });
          }
          return { productsSeen: targets.length, duplicatesSkipped: candidates.length - targets.length };
        },
        productsSeen: (result) => result.productsSeen,
        metrics: (result) => ({ duplicatesSkipped: result.duplicatesSkipped }),
        queueLag: () => 0,
      });
    }

    if ((source === "amazon" || (source === "all" && input.scanAmazon !== false)) && config.keepaApiKey) {
      const segments: RemoteDiscoverySegment[] = input.useRemoteDiscovery === true && plan.discoverySegments.length > 0
        ? plan.discoverySegments
        : inputMarkets(input).map((market) => ({
            id: `${market}:fallback`,
            market,
            label: "Découverte générale",
            categoryIds: [],
            minPriceCents: 1,
            maxPriceCents: 100_000_000,
            minimumDropPercent,
            limit,
            page,
          }));
      const seenAmazonProducts = new Set<string>();
      const verifiedByMarket = new Map<Market, number>();
      for (const segment of segments) {
        const market = segment.market;
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
            limit: segment.limit,
            page: segment.page,
            minimumDropPercent: segment.minimumDropPercent,
            categoryIds: segment.categoryIds,
            minPriceCents: segment.minPriceCents,
            maxPriceCents: segment.maxPriceCents,
            fixture,
          });
          const uniqueObservations = observations.filter((observation) => {
            if (seenAmazonProducts.has(observation.alertCandidateId)) return false;
            seenAmazonProducts.add(observation.alertCandidateId);
            return true;
          });
          for (const observation of uniqueObservations) {
            const alreadyVerified = verifiedByMarket.get(market) ?? 0;
            const live = input.verifyAmazonPage !== false && alreadyVerified < liveVerificationLimit
              ? await liveVerifyKeepaObservation(observation, config, {
                  browserFallback: input.browserFallback ?? config.browserFallback,
                })
              : { observation, liveVerified: false, errorCode: "AMAZON_LIVE_SKIPPED" };
            if (live.liveVerified) verifiedByMarket.set(market, alreadyVerified + 1);
            if (!fixture) {
              await deliverObservation(live.observation, config, { allowPush: input.notify === true });
            }
            await Actor.pushData({
              dataKind: "verified-observation",
              discoverySegmentId: segment.id,
              discoverySegmentLabel: segment.label,
              liveVerified: live.liveVerified,
              liveVerificationErrorCode: live.errorCode,
              ...live.observation,
            });
          }
            return uniqueObservations.length;
          },
          productsSeen: (count) => count,
          metrics: (count) => ({
            keepaRequests: 2,
            discoverySegmentId: segment.id,
            discoveryYieldCount: count,
          }),
          queueLag: () => 0,
        });
      }
    }
  } finally {
    await Actor.exit();
  }
}
