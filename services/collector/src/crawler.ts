import {
  CheerioCrawler,
  LogLevel,
  PlaywrightCrawler,
  ProxyConfiguration,
  log,
} from "crawlee";
import { chromium } from "playwright";
import type { Locator, Page } from "playwright";

import {
  connectorForUrl,
  discoverNextPageUrl,
  discoverProductUrls,
  extractRetailOffers,
} from "./connectors/index.js";
import { verifyWithSecondRead } from "./verify.js";
import type { OfferSnapshot, VerifiedObservation } from "./types.js";
import { parseMoneyMinor } from "./normalize.js";

export interface ScanOptions {
  browserFallback?: boolean;
  fixture?: boolean;
  timeoutMs?: number;
  maxDiscoveredUrls?: number;
  proxyUrls?: readonly string[];
  shadowCart?: boolean;
}

const FORBIDDEN_COMMERCE_ACTION = /(?:buy\s*now|acheter\s*maintenant|commander|passer\s*la\s*commande|checkout|paiement|payment|place\s*order|proceed\s*to\s*checkout|finaliser)/iu;

function normalizedText(value: string): string {
  return value.normalize("NFKD").replace(/\p{M}/gu, "").toLowerCase().replace(/[^a-z0-9]+/gu, " ").trim();
}

export function cartTextMatchesOffer(text: string, offer: OfferSnapshot): boolean {
  const haystack = normalizedText(text);
  const merchantId = normalizedText(offer.variantIdentity?.merchantProductId ?? offer.product.externalId).replace(/\s/gu, "");
  if (merchantId.length >= 5 && haystack.replace(/\s/gu, "").includes(merchantId)) return true;
  const ignored = new Set(["avec", "pour", "sans", "dans", "noir", "blanc", "bleu", "neuf", "the", "and", "with"]);
  const tokens = [...new Set(normalizedText(`${offer.product.brand ?? ""} ${offer.product.model ?? ""} ${offer.product.title}`)
    .split(" ")
    .filter((token) => token.length >= 4 && !ignored.has(token)))]
    .sort((left, right) => right.length - left.length)
    .slice(0, 6);
  const matches = tokens.filter((token) => haystack.includes(token));
  return matches.length >= Math.min(2, tokens.length) && matches.length > 0;
}

function cartMoney(value: string | null): number | null {
  if (value === null) return null;
  const normalized = normalizedText(value);
  if (/\b(?:gratuit|gratuite|gratis|kostenlos|free)\b/u.test(normalized)) return 0;
  return parseMoneyMinor(value);
}

async function firstVisibleLocator(page: Page, selectors: readonly string[]): Promise<Locator | null> {
  for (const selector of selectors) {
    const locator = page.locator(selector).first();
    try {
      if (await locator.isVisible({ timeout: 350 })) return locator;
    } catch {
      // A stale merchant node is ignored; the next versioned selector is tried.
    }
  }
  return null;
}

async function visibleText(page: Page, selectors: readonly string[]): Promise<string> {
  const parts: string[] = [];
  for (const selector of selectors) {
    const locator = page.locator(selector).first();
    try {
      if (await locator.isVisible({ timeout: 250 })) {
        const value = (await locator.innerText({ timeout: 700 })).trim();
        if (value) parts.push(value.slice(0, 12_000));
      }
    } catch {
      // Dynamic cart layers can disappear while being read.
    }
  }
  return parts.join("\n").slice(0, 30_000);
}

async function firstVisibleText(page: Page, selectors: readonly string[]): Promise<string | null> {
  const locator = await firstVisibleLocator(page, selectors);
  if (!locator) return null;
  try {
    return (await locator.innerText({ timeout: 700 })).trim() || null;
  } catch {
    return null;
  }
}

async function safeAddControl(locator: Locator): Promise<boolean> {
  try {
    const descriptor = await locator.evaluate((element) => {
      const formAction = element.closest("form")?.getAttribute("action") ?? "";
      return [
        element.textContent ?? "",
        element.getAttribute("aria-label") ?? "",
        element.getAttribute("title") ?? "",
        element.getAttribute("name") ?? "",
        element.getAttribute("id") ?? "",
        element.getAttribute("href") ?? "",
        formAction,
      ].join(" ");
    });
    return !FORBIDDEN_COMMERCE_ACTION.test(descriptor);
  } catch {
    return false;
  }
}

async function probeShadowCart(page: Page, offer: OfferSnapshot): Promise<NonNullable<OfferSnapshot["cartProbe"]>> {
  const base = offer.cartProbe ?? {
    status: offer.availability === "out_of_stock" ? "unavailable" as const : "product_page" as const,
    itemCents: offer.price.amountMinor,
    shippingCents: offer.shipping?.amountMinor ?? null,
    totalCents: offer.total?.amountMinor ?? null,
    stockConfirmed: offer.availability === "in_stock",
    addToCartAvailable: false,
    identityConfirmed: false,
    explicitShipping: false,
    explicitTotal: false,
    couponApplied: offer.promotion?.type !== "coupon",
    checkedAt: null,
  };
  if (offer.availability === "out_of_stock") return { ...base, status: "unavailable", checkedAt: new Date().toISOString() };
  const connector = connectorForUrl(offer.product.url);
  const adapter = connector.shadowCart;
  try {
    const addButton = await firstVisibleLocator(page, adapter.addButton);
    if (!addButton) return { ...base, checkedAt: new Date().toISOString() };
    if (!(await safeAddControl(addButton))) {
      return { ...base, status: "blocked", addToCartAvailable: true, checkedAt: new Date().toISOString() };
    }
    await addButton.click({ timeout: 4_000 });
    await page.waitForTimeout(900);
    const current = new URL(page.url());
    if (/\/(?:checkout|payment|paiement|commande|order)(?:[/?]|$)/iu.test(current.pathname)) {
      return { ...base, status: "blocked", addToCartAvailable: true, checkedAt: new Date().toISOString() };
    }
    const confirmation = await visibleText(page, [...adapter.confirmation, ...adapter.cartScope]);
    const confirmationVisible = Boolean(await firstVisibleLocator(page, adapter.confirmation));
    const cartUrl = adapter.cartPathPatterns.some((pattern) => pattern.test(current.pathname));
    const itemText = await firstVisibleText(page, adapter.itemPrice);
    const shippingText = await firstVisibleText(page, adapter.shipping);
    const totalText = await firstVisibleText(page, adapter.total);
    const itemCents = cartMoney(itemText);
    const shippingCents = cartMoney(shippingText);
    const totalCents = cartMoney(totalText);
    const identityConfirmed = cartTextMatchesOffer(confirmation, offer);
    const explicitShipping = shippingText !== null && shippingCents !== null;
    const explicitTotal = totalText !== null && totalCents !== null;
    const couponApplied = offer.promotion?.type !== "coupon"
      || /(?:coupon|code|remise|rabais|gutschein|buono|cupon).{0,40}(?:appliqu|applied|angewendet|applicato|aplicado)/iu.test(confirmation);
    const totalConsistent = itemCents !== null
      && shippingCents !== null
      && totalCents !== null
      && Math.abs(totalCents - (itemCents + shippingCents)) <= 1;
    const cartConfirmed = (confirmationVisible || cartUrl)
      && identityConfirmed
      && explicitShipping
      && explicitTotal
      && totalConsistent
      && couponApplied;
    return {
      ...base,
      status: cartConfirmed ? "confirmed" : "product_page",
      itemCents,
      shippingCents,
      totalCents,
      stockConfirmed: cartConfirmed,
      addToCartAvailable: true,
      identityConfirmed,
      explicitShipping,
      explicitTotal,
      couponApplied,
      checkedAt: new Date().toISOString(),
    };
  } catch {
    return { ...base, status: "blocked", addToCartAvailable: true, checkedAt: new Date().toISOString() };
  }
}

export interface ScanResult {
  requestedUrl: string;
  loadedUrl: string;
  transport: "http" | "browser";
  statusCode: number | null;
  offers: OfferSnapshot[];
  discoveredUrls: string[];
  nextPageUrl: string | null;
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
    offers: extractRetailOffers(html, loadedUrl, {
      fixture: options.fixture ?? false,
      requestedUrl,
    }),
    discoveredUrls: discoverProductUrls(html, loadedUrl, options.maxDiscoveredUrls ?? 100),
    nextPageUrl: discoverNextPageUrl(html, loadedUrl),
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
      const analyzed = analyzeHtml(await page.content(), url, loadedUrl, "browser", response?.status() ?? null, options);
      if (options.shadowCart && analyzed.offers[0]) {
        analyzed.offers[0] = { ...analyzed.offers[0], cartProbe: await probeShadowCart(page, analyzed.offers[0]) };
      }
      result = analyzed;
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
  if (options.shadowCart) return scanBrowser(url, { ...options, browserFallback: true });
  try {
    const result = await scanHttp(url, options);
    if (result.offers.length > 0 || result.discoveredUrls.length > 0 || result.nextPageUrl || !options.browserFallback) return result;
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
