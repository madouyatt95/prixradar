import { Actor } from "apify";

import { connectorForUrl } from "./connectors/index.js";
import { parseCoverageTargets, type CoverageTarget } from "./coverage-plan.js";
import { assertSourceScanAuthorized, publicWebScanOptions, scanSourceUrl, verifySourceUrl } from "./crawler.js";
import { isExtremeRetailCandidate, offerDiscountPercent } from "./deal-policy.js";
import type { CollectorConfig } from "./config.js";
import { KeepaClient, scanKeepaMarket, verifyKeepaCodeProduct } from "./keepa.js";
import {
  runReportedSourceAttempt,
  sourceAttempt,
  SourceStatusReporter,
} from "./source-status.js";
import { deliverObservation, deliverObservationSafely, liveVerifyKeepaObservation } from "./worker.js";
import { sendDailyDigests, sendProtectionPush } from "./push.js";
import { postEanScanResult, postFrontierItems, privateApiHeaders } from "./sink.js";
import { isPublicWebRetailSource, isRetailSource, type Market, type RetailSource } from "./types.js";

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
  pageRotation?: number;
  minimumDropPercent?: number;
  verifyAmazonPage?: boolean;
  liveVerificationLimit?: number;
  useRemoteCoverage?: boolean;
  useRemoteDiscovery?: boolean;
  processEanScans?: boolean;
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
type RemotePriority = { id: string; source: RetailSource; market: Market; url: string; kind: "inspection" | "frontier" | "purchase"; shadowCart: boolean };
type RemoteEanScan = {
  id: string;
  gtin: string;
  markets: Market[];
  knownProducts: Array<{ source: RetailSource; market: Market; url: string }>;
};
type ActorCoverageTarget = Omit<CoverageTarget, "sourceConfigurationId"> & { sourceConfigurationId: string | null };
type RemotePlan = { coverageTargets: CoverageTarget[]; discoverySegments: RemoteDiscoverySegment[]; rechecks: RemoteRecheck[]; priorityTasks: RemotePriority[]; eanScans: RemoteEanScan[] };

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

async function remotePlan(
  config: CollectorConfig,
  options: { source: RetailSource | "all"; includeEanScans: boolean },
): Promise<RemotePlan> {
  if (!config.priceRadarBaseUrl || !config.ingestSecret) return { coverageTargets: [], discoverySegments: [], rechecks: [], priorityTasks: [], eanScans: [] };
  const endpoint = new URL("api/source-plan", config.priceRadarBaseUrl.endsWith("/") ? config.priceRadarBaseUrl : `${config.priceRadarBaseUrl}/`);
  if (options.source !== "all") endpoint.searchParams.set("source", options.source);
  if (options.includeEanScans) endpoint.searchParams.set("includeEan", "1");
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
    eanScans?: unknown;
    frontier?: unknown;
    protectionChecks?: unknown;
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
      ...priorityItems(payload.protectionChecks, "purchase"),
    ],
    eanScans: Array.isArray(payload.eanScans) ? payload.eanScans.flatMap((candidate): RemoteEanScan[] => {
      if (!candidate || typeof candidate !== "object") return [];
      const value = candidate as Record<string, unknown>;
      const gtin = String(value.gtin ?? "");
      const id = String(value.id ?? "");
      if (!/^ean:[0-9a-f-]{36}$/u.test(id) || !/^\d{8,14}$/u.test(gtin)) return [];
      const markets = Array.isArray(value.markets)
        ? [...new Set(value.markets.map(String).filter((market): market is Market => ["FR", "DE", "IT", "ES", "GB"].includes(market)))]
        : ["FR"] as Market[];
      const knownProducts = Array.isArray(value.knownProducts) ? value.knownProducts.flatMap((candidateProduct): RemoteEanScan["knownProducts"] => {
        if (!candidateProduct || typeof candidateProduct !== "object") return [];
        const product = candidateProduct as Record<string, unknown>;
        const sourceValue = String(product.source ?? "");
        const market = String(product.market ?? "") as Market;
        const url = String(product.url ?? "");
        if (!isRetailSource(sourceValue) || !["FR", "DE", "IT", "ES", "GB"].includes(market)) return [];
        try {
          if (connectorForUrl(url).source !== sourceValue) return [];
        } catch { return []; }
        return [{ source: sourceValue, market, url }];
      }) : [];
      return [{ id, gtin, markets, knownProducts }];
    }) : [],
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
  await Actor.main(async () => {
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
    const page = Math.max(0, Math.min(49, Number.isSafeInteger(input.page) ? input.page ?? 0 : 0));
    const pageRotation = Math.max(1, Math.min(50 - page, Number.isSafeInteger(input.pageRotation) ? input.pageRotation ?? 1 : 1));
    const rotatingPage = (basePage: number) => Math.min(49, basePage + (Math.floor(Date.now() / (30 * 60_000)) % pageRotation));
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
      || input.useRemoteDiscovery === true
      || input.processEanScans === true;
    const plan = usesRemotePlan
      ? await remotePlan(config, { source, includeEanScans: input.processEanScans === true })
      : { coverageTargets: [], discoverySegments: [], rechecks: [], priorityTasks: [], eanScans: [] };
    const rawCoverageTargets: ActorCoverageTarget[] = configuredUrls.length > 0
      ? configuredUrls.map((url) => ({ url, sourceConfigurationId: null, productLimit: null }))
      : shouldUseRemoteCoverage ? plan.coverageTargets : [];
    const coverageTargets = [...new Map(rawCoverageTargets.map((target) => [
      `${target.sourceConfigurationId ?? "manual"}:${target.url}`,
      target,
    ])).values()];
    const seenProductUrls = new Set<string>();
    for (const task of plan.priorityTasks) {
      if (source !== "all" && task.source !== source) continue;
      if (seenProductUrls.has(task.url)) continue;
      try {
        const observation = await verifySourceUrl(task.url, publicWebScanOptions(task.source, {
          ...scanOptions,
          shadowCart: isPublicWebRetailSource(task.source) ? false : task.shadowCart,
          verifyDelayMs: config.verifyDelayMs,
        }));
        if (!fixture) await deliverObservation(observation, config, { allowPush: task.kind === "inspection" && input.notify === true });
        seenProductUrls.add(task.url);
        let protectionPush: unknown = null;
        if (task.kind === "purchase" && !fixture && config.priceRadarBaseUrl && config.pushDeliverySecret && config.vapidSubject && config.vapidPublicKey && config.vapidPrivateKey) {
          try {
            protectionPush = await sendProtectionPush(task.id, {
              baseUrl: config.priceRadarBaseUrl,
              deliverySecret: config.pushDeliverySecret,
              ...(config.sitesAuthToken ? { sitesAuthToken: config.sitesAuthToken } : {}),
              vapidSubject: config.vapidSubject,
              vapidPublicKey: config.vapidPublicKey,
              vapidPrivateKey: config.vapidPrivateKey,
              timeoutMs: config.httpTimeoutMs,
            });
          } catch (error) {
            protectionPush = { error: error instanceof Error ? error.message : "PUSH_PROTECTION_FAILED" };
          }
        }
        await Actor.pushData({ dataKind: `autonomous-${task.kind}`, requestId: task.id, protectionPush, ...observation });
      } catch (error) {
        const message = error instanceof Error ? error.message.toLowerCase() : "";
        await Actor.pushData({
          dataKind: `autonomous-${task.kind}-failure`,
          requestId: task.id,
          source: task.source,
          market: task.market,
          url: task.url,
          errorCode: /(?:403|429|captcha|blocked|access denied|robot)/u.test(message)
            ? "ANTI_BOT_BLOCKED"
            : "PRODUCT_VERIFICATION_FAILED",
        });
      }
    }
    for (const recheck of plan.rechecks) {
      if (source !== "all" && recheck.source !== source) continue;
      try {
        const observation = await verifySourceUrl(recheck.url, publicWebScanOptions(recheck.source, {
          ...scanOptions,
          verifyDelayMs: config.verifyDelayMs,
          shadowCart: isPublicWebRetailSource(recheck.source) ? false : input.shadowCart ?? true,
        }));
        if (!fixture) await deliverObservation(observation, config, { allowPush: false });
        seenProductUrls.add(recheck.url);
        await Actor.pushData({ dataKind: "on-demand-recheck", requestId: recheck.id, alertId: recheck.alertId, ...observation });
      } catch (error) {
        const message = error instanceof Error ? error.message.toLowerCase() : "";
        await Actor.pushData({
          dataKind: "on-demand-recheck-failure",
          requestId: recheck.id,
          alertId: recheck.alertId,
          source: recheck.source,
          market: recheck.market,
          url: recheck.url,
          errorCode: /(?:403|429|captcha|blocked|access denied|robot)/u.test(message)
            ? "ANTI_BOT_BLOCKED"
            : "PRODUCT_VERIFICATION_FAILED",
        });
      }
    }
    for (const scan of input.processEanScans === true ? plan.eanScans : []) {
      const found = new Set<string>();
      const marketsChecked = new Set<Market>();
      let errorCode: string | null = null;
      for (const product of scan.knownProducts) {
        if (seenProductUrls.has(product.url)) continue;
        try {
          const observation = await verifySourceUrl(product.url, publicWebScanOptions(product.source, {
            ...scanOptions,
            shadowCart: !isPublicWebRetailSource(product.source),
            verifyDelayMs: config.verifyDelayMs,
          }));
          if (!fixture) await deliverObservation(observation, config, { allowPush: input.notify === true });
          seenProductUrls.add(product.url);
          found.add(`${product.source}:${product.market}:${product.url}`);
          await Actor.pushData({ dataKind: "ean-merchant-check", requestId: scan.id, gtin: scan.gtin, ...observation });
        } catch (error) {
          errorCode ??= /(?:403|429|captcha|blocked|access denied|robot)/iu.test(error instanceof Error ? error.message : "")
            ? "EAN_MERCHANT_BLOCKED"
            : "EAN_MERCHANT_CHECK_FAILED";
        }
      }
      if (config.keepaApiKey) {
        const client = new KeepaClient({
          apiKey: config.keepaApiKey,
          timeoutMs: config.httpTimeoutMs,
          maxQuotaWaitMs: config.keepaMaxQuotaWaitMs,
        });
        for (const market of scan.markets) {
          try {
            const products = await client.productsByCodes(market, [scan.gtin]);
            marketsChecked.add(market);
            for (const product of products.slice(0, 5)) {
              const keepaObservation = verifyKeepaCodeProduct(product, fixture);
              const live = input.verifyAmazonPage !== false
                ? await liveVerifyKeepaObservation(keepaObservation, config, {
                    browserFallback: input.browserFallback ?? config.browserFallback,
                  })
                : { observation: keepaObservation, liveVerified: false, errorCode: "AMAZON_LIVE_SKIPPED" };
              if (!fixture) await deliverObservation(live.observation, config, { allowPush: input.notify === true });
              found.add(`amazon:${market}:${product.asin}`);
              await Actor.pushData({
                dataKind: "ean-amazon-check",
                requestId: scan.id,
                gtin: scan.gtin,
                liveVerified: live.liveVerified,
                liveVerificationErrorCode: live.errorCode,
                ...live.observation,
              });
            }
          } catch (error) {
            errorCode = error instanceof Error && "code" in error && error.code === "quota"
              ? "KEEPA_QUOTA_DEFERRED"
              : "KEEPA_EAN_LOOKUP_FAILED";
            if (errorCode === "KEEPA_QUOTA_DEFERRED") break;
          }
        }
      } else {
        errorCode ??= "KEEPA_NOT_CONFIGURED";
      }
      if (!fixture && config.priceRadarBaseUrl && config.ingestSecret) {
        await postEanScanResult({
          id: scan.id,
          productsFound: found.size,
          marketsChecked: [...marketsChecked],
          errorCode: found.size > 0 ? null : errorCode,
        }, {
          baseUrl: config.priceRadarBaseUrl,
          ingestSecret: config.ingestSecret,
          ...(config.sitesAuthToken ? { sitesAuthToken: config.sitesAuthToken } : {}),
          timeoutMs: config.httpTimeoutMs,
        });
      }
    }
    for (const coverageTarget of coverageTargets) {
      const { url, sourceConfigurationId, productLimit } = coverageTarget;
      const connector = connectorForUrl(url);
      if (source !== "all" && source !== connector.source) {
        continue;
      }
      try {
        const sourceScanOptions = publicWebScanOptions(connector.source, scanOptions);
        assertSourceScanAuthorized(url, sourceScanOptions);
        await runReportedSourceAttempt({
          reporter: statusReporter,
          attempt: sourceAttempt(connector.source, connector.market, fixture),
          baseMetrics: { sourceConfigurationId },
          run: async () => {
          const coverageScanOptions = {
            ...sourceScanOptions,
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
          const productTarget = connector.productPathPatterns.some((pattern) => pattern.test(new URL(url).pathname));
          const targetUrls = initialScan
            ? (productTarget && initialScan.offers.length > 0 ? [url] : initialScan.discoveredUrls.slice(0, productLimit ?? limit))
            : [url];
          const candidates = initialScan ? targetUrls : [url];
          const targets = candidates.filter((targetUrl) => {
            if (seenProductUrls.has(targetUrl)) return false;
            seenProductUrls.add(targetUrl);
            return true;
          });
          let verifiedProducts = 0;
          let policySkipped = 0;
          let verificationFailures = 0;
          let antiBotBlocked = false;
          for (const targetUrl of targets) {
            try {
              if (connector.source === "jd_sports") {
                const preview = await scanSourceUrl(targetUrl, {
                  ...scanOptions,
                  browserFallback: false,
                  maxDiscoveredUrls: 1,
                  shadowCart: false,
                });
                const previewOffer = preview.offers[0];
                if (!previewOffer || !isExtremeRetailCandidate(previewOffer)) {
                  policySkipped += 1;
                  await Actor.pushData({
                    dataKind: "deal-policy-skipped",
                    source: connector.source,
                    url: targetUrl,
                    reason: previewOffer ? "DISCOUNT_BELOW_70_OR_ACCESSORY" : "NO_HTTP_OFFER",
                    discountPercent: previewOffer ? offerDiscountPercent(previewOffer) : null,
                  });
                  continue;
                }
              }
              const observation = await verifySourceUrl(targetUrl, {
                ...sourceScanOptions,
                verifyDelayMs: config.verifyDelayMs,
                shadowCart: isPublicWebRetailSource(connector.source) ? false : input.shadowCart ?? mode === "verify",
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
            productsSeen: verifiedProducts + policySkipped,
            duplicatesSkipped: candidates.length - targets.length,
            nextPageCursor: initialScan ? initialScan.nextPageUrl : undefined,
            attemptedProducts: targets.length,
            verificationFailures,
            policySkipped,
            antiBotBlocked,
          };
        },
        productsSeen: (result) => result.productsSeen,
        metrics: (result) => ({
          duplicatesSkipped: result.duplicatesSkipped,
          antiBotBlocked: result.antiBotBlocked,
          policySkipped: result.policySkipped,
          ...(result.nextPageCursor !== undefined ? { nextPageCursor: result.nextPageCursor } : {}),
        }),
        degradedErrorCode: (result) => result.antiBotBlocked
          ? "ANTI_BOT_BLOCKED"
          : result.attemptedProducts > 0 && result.verificationFailures === result.attemptedProducts
            ? "PRODUCT_VERIFICATION_FAILED"
            : null,
          queueLag: () => 0,
        });
      } catch (error) {
        const message = error instanceof Error ? error.message.toLowerCase() : "";
        const blocked = /(?:403|429|captcha|blocked|access denied|robot)/u.test(message);
        await Actor.pushData({
          dataKind: "source-failure",
          source: connector.source,
          market: connector.market,
          url,
          sourceConfigurationId,
          errorCode: blocked ? "ANTI_BOT_BLOCKED" : "COLLECTOR_JOB_FAILED",
        });
      }
    }

    if ((source === "amazon" || (source === "all" && input.scanAmazon !== false)) && config.keepaApiKey) {
      const requestedMarkets = inputMarkets(input);
      const requestedMarketSet = new Set<Market>(requestedMarkets);
      const requestedRemoteSegments = plan.discoverySegments.filter((segment) => requestedMarketSet.has(segment.market));
      const segments: RemoteDiscoverySegment[] = input.useRemoteDiscovery === true && requestedRemoteSegments.length > 0
        ? requestedRemoteSegments
        : requestedMarkets.map((market) => ({
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
      const keepaClient = new KeepaClient({
        apiKey: config.keepaApiKey,
        timeoutMs: config.httpTimeoutMs,
        maxQuotaWaitMs: config.keepaMaxQuotaWaitMs,
      });
      for (const segment of segments) {
        const market = segment.market;
        await runReportedSourceAttempt({
          reporter: statusReporter,
          attempt: sourceAttempt("amazon", market, fixture),
          run: async () => {
            const observations = await scanKeepaMarket(keepaClient, market, {
              limit: segment.limit,
              page: rotatingPage(segment.page),
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
            let deliveredProducts = 0;
            let deliveryFailures = 0;
            for (const observation of uniqueObservations) {
              const alreadyVerified = verifiedByMarket.get(market) ?? 0;
              const live = input.verifyAmazonPage !== false && alreadyVerified < liveVerificationLimit
                ? await liveVerifyKeepaObservation(observation, config, {
                    browserFallback: input.browserFallback ?? config.browserFallback,
                  })
                : { observation, liveVerified: false, errorCode: "AMAZON_LIVE_SKIPPED" };
              if (live.liveVerified) verifiedByMarket.set(market, alreadyVerified + 1);
              let ingestionAccepted: boolean | null = null;
              if (!fixture) {
                const delivery = await deliverObservationSafely(live.observation, config, {
                  allowPush: input.notify === true,
                });
                ingestionAccepted = delivery.delivered;
                if (delivery.delivered) {
                  deliveredProducts += 1;
                } else {
                  deliveryFailures += 1;
                  await Actor.pushData({
                    dataKind: "observation-delivery-failure",
                    discoverySegmentId: segment.id,
                    discoverySegmentLabel: segment.label,
                    alertCandidateId: live.observation.alertCandidateId,
                    productKey: live.observation.offer.product.productKey,
                    source: live.observation.offer.product.source,
                    market: live.observation.offer.product.market,
                    errorCode: delivery.errorCode,
                  });
                }
              }
              await Actor.pushData({
                dataKind: "verified-observation",
                discoverySegmentId: segment.id,
                discoverySegmentLabel: segment.label,
                liveVerified: live.liveVerified,
                liveVerificationErrorCode: live.errorCode,
                ingestionAccepted,
                ...live.observation,
              });
            }
            if (!fixture && uniqueObservations.length > 0 && deliveredProducts === 0) {
              throw new Error("Toutes les observations Amazon ont été refusées par l'ingestion.");
            }
            return {
              productsSeen: fixture ? uniqueObservations.length : deliveredProducts,
              discoveryYieldCount: uniqueObservations.length,
              deliveryFailures,
            };
          },
          productsSeen: (result) => result.productsSeen,
          metrics: (result) => ({
            keepaRequests: 2,
            discoverySegmentId: segment.id,
            discoveryYieldCount: result.discoveryYieldCount,
            extractionFailures: result.deliveryFailures,
          }),
          queueLag: () => 0,
        });
      }
    }
  });
}
