import * as cheerio from "cheerio";

import { extractJsonLdOffers } from "./jsonld.js";
import {
  cleanText,
  normalizeProductUrl,
  parseMoneyMinor,
  productKey,
} from "../normalize.js";
import type { Currency, Market, OfferSnapshot, RetailSource } from "../types.js";

export interface RetailConnector {
  source: Exclude<RetailSource, "amazon">;
  market: Extract<Market, "FR">;
  currency: Extract<Currency, "EUR">;
  allowedHosts: ReadonlySet<string>;
  productPathPatterns: readonly RegExp[];
  selectors: {
    title: readonly string[];
    price: readonly string[];
    referencePrice: readonly string[];
    externalId: readonly string[];
  };
}

const BOULANGER: RetailConnector = {
  source: "boulanger",
  market: "FR",
  currency: "EUR",
  allowedHosts: new Set(["boulanger.com", "www.boulanger.com"]),
  productPathPatterns: [/^\/ref\/[A-Za-z0-9_-]+\/?$/u],
  selectors: {
    title: ["h1", "[itemprop='name']", "meta[property='og:title']"],
    price: ["[itemprop='price']", "meta[property='product:price:amount']", "[data-testid*='price']"],
    referencePrice: ["[data-testid*='old-price']", ".old-price", ".price--crossed"],
    externalId: ["[itemprop='sku']", "[data-product-id]", "[data-ref]"],
  },
};

const DARTY: RetailConnector = {
  source: "darty",
  market: "FR",
  currency: "EUR",
  allowedHosts: new Set(["darty.com", "www.darty.com"]),
  productPathPatterns: [/^\/nav\/achat\/.+\.html$/u],
  selectors: {
    title: ["h1", "[itemprop='name']", "meta[property='og:title']"],
    price: ["[itemprop='price']", "meta[property='product:price:amount']", "[data-testid*='price']"],
    referencePrice: [".darty_prix_barre", ".old_price", "[data-testid*='old-price']"],
    externalId: ["[itemprop='sku']", "[data-product-id]", "[data-sku]"],
  },
};

const CDISCOUNT: RetailConnector = {
  source: "cdiscount",
  market: "FR",
  currency: "EUR",
  allowedHosts: new Set(["cdiscount.com", "www.cdiscount.com"]),
  productPathPatterns: [/^\/.+\/f-\d+[a-z0-9-]*\.html$/iu],
  selectors: {
    title: ["h1", "[itemprop='name']", "meta[property='og:title']"],
    price: ["[itemprop='price']", "meta[property='product:price:amount']", "[data-testid*='price']"],
    referencePrice: [".fpStriked", ".oldPrice", "[data-testid*='old-price']"],
    externalId: ["[itemprop='sku']", "[data-product-id]", "[data-sku]"],
  },
};

export const RETAIL_CONNECTORS = [BOULANGER, DARTY, CDISCOUNT] as const;

export function connectorForUrl(rawUrl: string): RetailConnector {
  let url: URL;
  try {
    url = new URL(rawUrl);
  } catch {
    throw new Error("URL source invalide.");
  }
  if (url.protocol !== "https:" || url.username || url.password) {
    throw new Error("Seules les URL HTTPS sans identifiants sont acceptées.");
  }
  const host = url.hostname.toLowerCase().replace(/\.$/u, "");
  const connector = RETAIL_CONNECTORS.find((candidate) => candidate.allowedHosts.has(host));
  if (!connector) throw new Error("Hôte marchand non autorisé.");
  return connector;
}

function selectorValue($: cheerio.CheerioAPI, selectors: readonly string[]): string | null {
  for (const selector of selectors) {
    const element = $(selector).first();
    if (element.length === 0) continue;
    const value = element.attr("content")
      ?? element.attr("value")
      ?? element.attr("data-product-id")
      ?? element.attr("data-sku")
      ?? element.attr("data-ref")
      ?? element.text();
    const cleaned = cleanText(value);
    if (cleaned) return cleaned;
  }
  return null;
}

function fallbackOffer(
  html: string,
  pageUrl: string,
  connector: RetailConnector,
  options: { observedAt?: string; fixture?: boolean },
): OfferSnapshot | null {
  const $ = cheerio.load(html);
  const title = selectorValue($, connector.selectors.title);
  const priceMinor = parseMoneyMinor(selectorValue($, connector.selectors.price));
  if (!title || priceMinor === null || priceMinor <= 0) return null;

  const url = normalizeProductUrl(pageUrl, connector.allowedHosts);
  const externalId = selectorValue($, connector.selectors.externalId)
    ?? url.match(/(?:\/ref\/|\/f-)([A-Za-z0-9_-]+)/u)?.[1]
    ?? url;
  const referenceMinor = parseMoneyMinor(selectorValue($, connector.selectors.referencePrice));

  return {
    product: {
      productKey: productKey({ source: connector.source, market: connector.market, externalId }),
      source: connector.source,
      market: connector.market,
      externalId,
      title,
      brand: null,
      model: null,
      gtin: null,
      url,
      imageUrl: cleanText($("meta[property='og:image']").attr("content"), 2_048),
    },
    price: { amountMinor: priceMinor, currency: connector.currency },
    shipping: null,
    total: null,
    referencePrice: referenceMinor !== null && referenceMinor > priceMinor
      ? { amountMinor: referenceMinor, currency: connector.currency }
      : null,
    seller: null,
    sellerTrusted: false,
    condition: "new",
    availability: "unknown",
    observedAt: options.observedAt ?? new Date().toISOString(),
    strategy: "connector",
    fixture: options.fixture ?? false,
  };
}

export function extractRetailOffers(
  html: string,
  pageUrl: string,
  options: { observedAt?: string; fixture?: boolean } = {},
): OfferSnapshot[] {
  const connector = connectorForUrl(pageUrl);
  const structured = extractJsonLdOffers(html, {
    source: connector.source,
    market: connector.market,
    currency: connector.currency,
    pageUrl,
    allowedHosts: connector.allowedHosts,
    ...options,
  });
  if (structured.length > 0) return structured;
  const fallback = fallbackOffer(html, pageUrl, connector, options);
  return fallback ? [fallback] : [];
}

export function discoverProductUrls(html: string, pageUrl: string, limit = 100): string[] {
  const connector = connectorForUrl(pageUrl);
  const $ = cheerio.load(html);
  const unique = new Set<string>();

  for (const link of $("a[href]").toArray()) {
    const href = $(link).attr("href");
    if (!href) continue;
    try {
      const candidate = normalizeProductUrl(new URL(href, pageUrl).toString(), connector.allowedHosts);
      const path = new URL(candidate).pathname;
      if (!connector.productPathPatterns.some((pattern) => pattern.test(path))) continue;
      unique.add(candidate);
      if (unique.size >= limit) break;
    } catch {
      // External, malformed and non-HTTPS links are ignored.
    }
  }
  return [...unique];
}
