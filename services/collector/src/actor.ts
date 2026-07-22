import { Actor } from "apify";

import { connectorForUrl } from "./connectors/index.js";
import { parseCoverageTargets, type CoverageTarget } from "./coverage-plan.js";
import { assertSourceScanAuthorized, scanSourceUrl, verifySourceUrl } from "./crawler.js";
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
import { isRetailSource, type Market, type RetailSource } from "./types.js";

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
type ActorCoverageTarget = Omit<CoverageTarget, "sourceConfigurationId"> & { sourceConfigurationId: string | null };
type RemotePlan = { coverageTargets: CoverageTarget[]; discoverySegments: RemoteDiscoverySegment[]; rechecks: RemoteRecheck[]; priorityTasks: RemotePriority[] };

function priorityItems(value: unknown, kind: RemotePriority["kind"]): RemotePriority[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((candidate): RemotePriority[] => {
    if (!candidate || typeof candidate !== "object") return [];
    const item = candidate as Record<string, unknown>;
    const sourceValue = String(item.source ?? "");
    const market = String(item.market ?? "") as Market;
    const url = String(item.url ?? "");
    if (!isRetailSource(sourceValue) || !["FR", "DE", "IT", "ES", "GB"].includes(market)) return [];
    const source = sourceValue;
    try {
      if (connectorForUrl(url).source !== source) return [];
    } catch {
      return [];
    }
    return [{ id: String(item.id ?? ""), source, market, url, kind, shadowCart: item.shadowCart !== false }];
  });
}

async function remotePlan(config: CollectorConfig): Promise<RemotePlan> {
  if (!config.priceRadarBaseUrl || !config.ingestSecret) return { coverageTargets: [], discoverySegments: [], rechecks: [], priorityTasks: [] };
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
    items?: Array<{
      id?: unknown;
      discoveryUrl?: unknown;
      discoveryStrategy?: unknown;
      pageCursor?: unknown;
      productLimit?: unknown;
    }>;
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
    coverageTargets: parseCoverageTargets(payload.items),
    discoverySegments: segments,
    rechecks: Array.isArray(payload.rechecks) ? payload.rechecks.flatMap((candidate): RemoteRecheck[] => {
      if (!candidate || typeof candidate !== "object") return [];
      const value = candidate as Record<string, unknown>;
      const sourceValue = String(value.source ?? "");
      const market = String(value.market ?? "") as Market;
      const url = String(value.url ?? "");
      if (!isRetailSource(sourceValue) || !["FR", "DE", "IT", "ES", "GB"].includes(market)) return [];
      const source = sourceValue;
      try {
        if (connectorForUrl(url).source !== source) return [];
      } catch {
        return [];
      }
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
      authorizedPartnerSources: config.authorizedPartnerSources,
    };

    const sourceValue = String(input.source ?? "all");
    if (sourceValue !== "all" && !isRetailSource(sourceValue)) {
      throw new Error(`Source Actor non prise en charge: ${sourceValue}.`);
    }
    const source: RetailSource | "all" = sourceValue;
    const configuredUrls = inputUrls(input.urls);
    const shouldUseRemoteCoverage = configuredUrls.length === 0 && input.useRemoteCoverage !== false;
    const usesRemotePlan = shouldUseRemoteCoverage
      || input.useRemoteDiscovery === true;
    const plan = usesRemotePlan ? await remotePlan(config) : { coverageTargets: [], discoverySegments: [], rechecks: [], priorityTasks: [] };
    const rawCoverageTargets: ActorCoverageTarget[] = configuredUrls.length > 0
      ? configuredUrls.map((url) => ({ url, sourceConfigurationId: null, productLimit: null }))
      : shouldUseRemoteCoverage ? plan.coverageTargets : [];
    const coverageTargets = [...new Map(rawCoverageTargets.map((target) => [
      `${target.sourceConfigurationId ?? "manual"}:${target.url}`,
      target,
    ])).values()];
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
    for (const coverageTarget of coverageTargets) {
      const { url, sourceConfigurationId, productLimit } = coverageTarget;
      const connector = connectorForUrl(url);
      assertSourceScanAuthorized(url, scanOptions);
      if (source !== "all" && source !== connector.source) {
        throw new Error(`L’URL ne correspond pas à la source ${source}.`);
      }
      await runReportedSourceAttempt({
        reporter: statusReporter,
        attempt: sourceAttempt(connector.source, connector.market, fixture),
        baseMetrics: { sourceConfigurationId },
        run: async () => {
          const coverageScanOptions = {
            ...scanOptions,
            maxDiscoveredUrls: Math.min(productLimit ?? limit, config.maxDiscoveredUrls),
          };
          if (mode === "discover") {
            const result = await scanSourceUrl(url, coverageScanOptions);
            await Actor.pushData({ dataKind: "discovery", fixture, ...result });
            if (!fixture && config.priceRadarBaseUrl && config.ingestSecret) {
              await postFrontierItems(result.discoveredUrls.map((productUrl) => ({
                url: productUrl,
                discoveredFrom: result.loadedUrl,
                depth: 1,
                sourceConfigurationId,
              })), {
                baseUrl: config.priceRadarBaseUrl,
                ingestSecret: config.ingestSecret,
                ...(config.sitesAuthToken ? { sitesAuthToken: config.sitesAuthToken } : {}),
                timeoutMs: config.httpTimeoutMs,
              });
            }
            const unseen = result.discoveredUrls.filter((productUrl) => !seenProductUrls.has(productUrl));
            unseen.forEach((productUrl) => seenProductUrls.add(productUrl));
            return {
              productsSeen: unseen.length,
              duplicatesSkipped: result.discoveredUrls.length - unseen.length,
              nextPageCursor: result.nextPageUrl,
              attemptedProducts: 0,
              verificationFailures: 0,
              antiBotBlocked: false,
            };
          }
          const initialScan = mode === "full" ? await scanSourceUrl(url, coverageScanOptions) : null;
          if (initialScan && !fixture && config.priceRadarBaseUrl && config.ingestSecret && initialScan.discoveredUrls.length > 0) {
            await postFrontierItems(initialScan.discoveredUrls.map((productUrl) => ({
              url: productUrl,
              discoveredFrom: initialScan.loadedUrl,
              depth: 1,
              sourceConfigurationId,
            })), {
              baseUrl: config.priceRadarBaseUrl,
              ingestSecret: config.ingestSecret,
              ...(config.sitesAuthToken ? { sitesAuthToken: config.sitesAuthToken } : {}),
              timeoutMs: config.httpTimeoutMs,
            });
          }
          const targetUrls = initialScan
            ? (initialScan.offers.length > 0 ? [url] : initialScan.discoveredUrls.slice(0, productLimit ?? limit))
            : [url];
          const candidates = targetUrls.length > 0 ? targetUrls : [url];
          const targets = candidates.filter((targetUrl) => {
            if (seenProductUrls.has(targetUrl)) return false;
            seenProductUrls.add(targetUrl);
            return true;
          });
          let verifiedProducts = 0;
          let verificationFailures = 0;
          let antiBotBlocked = false;
          for (const targetUrl of targets) {
            try {
              const observation = await verifySourceUrl(targetUrl, {
                ...scanOptions,
                verifyDelayMs: config.verifyDelayMs,
                shadowCart: input.shadowCart ?? mode === "verify",
              });
              if (!fixture) {
                await deliverObservation(observation, config, { allowPush: input.notify === true });
              }
              await Actor.pushData({ dataKind: "verified-observation", ...observation });
              verifiedProducts += 1;
            } catch (error) {
              verificationFailures += 1;
              const message = error instanceof Error ? error.message.toLowerCase() : "";
              const blocked = /(?:403|429|captcha|blocked|access denied|robot)/u.test(message);
              antiBotBlocked ||= blocked;
              await Actor.pushData({
                dataKind: "verification-failure",
                url: targetUrl,
                errorCode: blocked ? "ANTI_BOT_BLOCKED" : "PRODUCT_VERIFICATION_FAILED",
              });
            }
          }
          return {
            productsSeen: verifiedProducts,
            duplicatesSkipped: candidates.length - targets.length,
            nextPageCursor: initialScan ? initialScan.nextPageUrl : undefined,
            attemptedProducts: targets.length,
            verificationFailures,
            antiBotBlocked,
          };
        },
        productsSeen: (result) => result.productsSeen,
        metrics: (result) => ({
          duplicatesSkipped: result.duplicatesSkipped,
          antiBotBlocked: result.antiBotBlocked,
          ...(result.nextPageCursor !== undefined ? { nextPageCursor: result.nextPageCursor } : {}),
        }),
        degradedErrorCode: (result) => result.antiBotBlocked
          ? "ANTI_BOT_BLOCKED"
          : result.attemptedProducts > 0 && result.verificationFailures === result.attemptedProducts
            ? "PRODUCT_VERIFICATION_FAILED"
            : null,
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
