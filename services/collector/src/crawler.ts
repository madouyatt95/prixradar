import {
  CheerioCrawler,
  LogLevel,
  PlaywrightCrawler,
  ProxyConfiguration,
  log,
} from "crawlee";
import { chromium } from "playwright";

import {
  connectorForUrl,
  discoverProductUrls,
  extractRetailOffers,
} from "./connectors/index.js";
import { verifyWithSecondRead } from "./verify.js";
import type { OfferSnapshot, VerifiedObservation } from "./types.js";

export interface ScanOptions {
  browserFallback?: boolean;
  fixture?: boolean;
  timeoutMs?: number;
  maxDiscoveredUrls?: number;
  proxyUrls?: readonly string[];
}

export interface ScanResult {
  requestedUrl: string;
  loadedUrl: string;
  transport: "http" | "browser";
  statusCode: number | null;
  offers: OfferSnapshot[];
  discoveredUrls: string[];
}

export class CollectorNavigationError extends Error {
  override name = "CollectorNavigationError";
}

log.setLevel(LogLevel.ERROR);

function proxyConfiguration(proxyUrls: readonly string[] | undefined): ProxyConfiguration | undefined {
  const cleaned = proxyUrls?.map((value) => value.trim()).filter(Boolean) ?? [];
  if (cleaned.length === 0) return undefined;
  for (const raw of cleaned) {
    const url = new URL(raw);
    if (url.protocol !== "http:" && url.protocol !== "https:" && url.protocol !== "socks5:") {
      throw new Error("PROXY_URLS contient un protocole non pris en charge.");
    }
  }
  return new ProxyConfiguration({ proxyUrls: cleaned });
}

function analyzeHtml(
  html: string,
  requestedUrl: string,
  loadedUrl: string,
  transport: ScanResult["transport"],
  statusCode: number | null,
  options: ScanOptions,
): ScanResult {
  const requestedConnector = connectorForUrl(requestedUrl);
  const loadedConnector = connectorForUrl(loadedUrl);
  if (requestedConnector.source !== loadedConnector.source) {
    throw new CollectorNavigationError("Redirection vers une autre source refusée.");
  }
  return {
    requestedUrl,
    loadedUrl,
    transport,
    statusCode,
    offers: extractRetailOffers(html, loadedUrl, { fixture: options.fixture ?? false }),
    discoveredUrls: discoverProductUrls(html, loadedUrl, options.maxDiscoveredUrls ?? 100),
  };
}

async function scanHttp(url: string, options: ScanOptions): Promise<ScanResult> {
  let result: ScanResult | null = null;
  let failureMessage: string | null = null;
  const proxies = proxyConfiguration(options.proxyUrls);
  const crawler = new CheerioCrawler({
    maxConcurrency: 1,
    maxRequestsPerCrawl: 1,
    maxRequestRetries: 0,
    requestHandlerTimeoutSecs: Math.ceil((options.timeoutMs ?? 15_000) / 1_000),
    navigationTimeoutSecs: Math.ceil((options.timeoutMs ?? 15_000) / 1_000),
    useSessionPool: true,
    persistCookiesPerSession: true,
    ...(proxies ? { proxyConfiguration: proxies } : {}),
    requestHandler: async ({ $, request, response }) => {
      const loadedUrl = request.loadedUrl ?? request.url;
      result = analyzeHtml($.html(), url, loadedUrl, "http", response?.statusCode ?? null, options);
    },
    failedRequestHandler: async ({ error }) => {
      failureMessage = error instanceof Error ? error.message : "Échec HTTP du collecteur.";
    },
  });
  await crawler.run([url]);
  if (result) return result;
  throw new CollectorNavigationError(failureMessage ?? "La collecte HTTP n’a produit aucune réponse.");
}

async function scanBrowser(url: string, options: ScanOptions): Promise<ScanResult> {
  let result: ScanResult | null = null;
  let failureMessage: string | null = null;
  const proxies = proxyConfiguration(options.proxyUrls);
  const crawler = new PlaywrightCrawler({
    launchContext: {
      launcher: chromium,
      launchOptions: { headless: true },
    },
    maxConcurrency: 1,
    maxRequestsPerCrawl: 1,
    maxRequestRetries: 0,
    requestHandlerTimeoutSecs: Math.ceil((options.timeoutMs ?? 30_000) / 1_000),
    navigationTimeoutSecs: Math.ceil((options.timeoutMs ?? 30_000) / 1_000),
    useSessionPool: true,
    persistCookiesPerSession: true,
    ...(proxies ? { proxyConfiguration: proxies } : {}),
    requestHandler: async ({ page, request, response }) => {
      await page.waitForLoadState("domcontentloaded");
      const loadedUrl = request.loadedUrl ?? page.url() ?? request.url;
      result = analyzeHtml(await page.content(), url, loadedUrl, "browser", response?.status() ?? null, options);
    },
    failedRequestHandler: async ({ error }) => {
      failureMessage = error instanceof Error ? error.message : "Échec navigateur du collecteur.";
    },
  });
  await crawler.run([url]);
  if (result) return result;
  throw new CollectorNavigationError(failureMessage ?? "Le navigateur n’a produit aucune réponse.");
}

export async function scanSourceUrl(url: string, options: ScanOptions = {}): Promise<ScanResult> {
  connectorForUrl(url);
  try {
    const result = await scanHttp(url, options);
    if (result.offers.length > 0 || result.discoveredUrls.length > 0 || !options.browserFallback) return result;
  } catch (error) {
    if (!options.browserFallback) throw error;
  }
  if (!options.browserFallback) {
    throw new CollectorNavigationError("Aucune donnée HTTP et repli navigateur désactivé.");
  }
  return scanBrowser(url, options);
}

export async function verifySourceUrl(
  url: string,
  options: ScanOptions & { verifyDelayMs?: number; baselineMinor?: number | null } = {},
): Promise<VerifiedObservation> {
  return verifyWithSecondRead(async () => {
    const scan = await scanSourceUrl(url, options);
    const offer = scan.offers[0];
    if (!offer) throw new CollectorNavigationError("Aucune offre produit extractible à cette URL.");
    return offer;
  }, {
    ...(options.verifyDelayMs === undefined ? {} : { delayMs: options.verifyDelayMs }),
    ...(options.baselineMinor === undefined ? {} : { baselineMinor: options.baselineMinor }),
  });
}
