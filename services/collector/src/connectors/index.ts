import * as cheerio from "cheerio";

import { extractJsonLdOffers } from "./jsonld.js";
import {
  cleanText,
  normalizeProductUrl,
  parseMoneyMinor,
  productKey,
} from "../normalize.js";
import type { Availability, Currency, Market, OfferSnapshot, RetailSource } from "../types.js";

export interface RetailConnector {
  source: RetailSource;
  market: Market;
  currency: Currency;
  allowedHosts: ReadonlySet<string>;
  productPathPatterns: readonly RegExp[];
  selectors: {
    title: readonly string[];
    price: readonly string[];
    referencePrice: readonly string[];
    externalId: readonly string[];
    shipping: readonly string[];
    seller: readonly string[];
    availability: readonly string[];
    condition: readonly string[];
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
    shipping: ["[itemprop='shippingDetails']", "[data-testid*='delivery']", "[data-testid*='shipping']"],
    seller: ["[itemprop='seller']", "[data-testid*='seller']"],
    availability: ["[itemprop='availability']", "[data-testid*='availability']", "button[data-testid*='cart']"],
    condition: ["[itemprop='itemCondition']", "[data-testid*='condition']"],
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
    shipping: ["[itemprop='shippingDetails']", "[class*='delivery']", "[data-testid*='shipping']"],
    seller: ["[itemprop='seller']", "[class*='seller']"],
    availability: ["[itemprop='availability']", "[class*='availability']", "button[class*='cart']"],
    condition: ["[itemprop='itemCondition']", "[class*='condition']"],
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
    shipping: ["[itemprop='shippingDetails']", "[class*='delivery']", "[class*='shipping']"],
    seller: ["[itemprop='seller']", "[class*='seller']", "[class*='merchant']"],
    availability: ["[itemprop='availability']", "[class*='availability']", "button[class*='cart']"],
    condition: ["[itemprop='itemCondition']", "[class*='condition']"],
  },
};

function amazonConnector(
  market: Market,
  currency: Currency,
  hosts: readonly string[],
): RetailConnector {
  return {
    source: "amazon",
    market,
    currency,
    allowedHosts: new Set(hosts),
    productPathPatterns: [/\/(?:dp|gp\/product)\/([A-Z0-9]{10})(?:[/?]|$)/iu],
    selectors: {
      title: ["#productTitle", "h1", "meta[property='og:title']"],
      price: ["#corePrice_feature_div .a-offscreen", ".priceToPay .a-offscreen", "#priceblock_ourprice", "#priceblock_dealprice"],
      referencePrice: [".basisPrice .a-offscreen", ".a-price.a-text-price .a-offscreen", "#listPrice"],
      externalId: ["input[name='ASIN']", "[data-asin]"],
      shipping: ["#mir-layout-DELIVERY_BLOCK-slot-PRIMARY_DELIVERY_MESSAGE_LARGE", "#deliveryBlockMessage", "[data-csa-c-delivery-price]"],
      seller: ["#sellerProfileTriggerId", "#merchant-info", "#tabular-buybox-truncate-1"],
      availability: ["#availability", "#add-to-cart-button", "#buy-now-button"],
      condition: ["#newAccordionRow", ".offer-display-condition", "[itemprop='itemCondition']"],
    },
  };
}

const AMAZON_CONNECTORS = [
  amazonConnector("FR", "EUR", ["amazon.fr", "www.amazon.fr"]),
  amazonConnector("DE", "EUR", ["amazon.de", "www.amazon.de"]),
  amazonConnector("IT", "EUR", ["amazon.it", "www.amazon.it"]),
  amazonConnector("ES", "EUR", ["amazon.es", "www.amazon.es"]),
  amazonConnector("GB", "GBP", ["amazon.co.uk", "www.amazon.co.uk"]),
] as const;

export const RETAIL_CONNECTORS = [BOULANGER, DARTY, CDISCOUNT, ...AMAZON_CONNECTORS] as const;

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
      ?? element.attr("data-asin")
      ?? element.attr("href")
      ?? element.text();
    const cleaned = cleanText(value);
    if (cleaned) return cleaned;
  }
  return null;
}

function promotionFromPage($: cheerio.CheerioAPI): NonNullable<OfferSnapshot["promotion"]> {
  const text = selectorValue($, [
    "#couponText",
    "[data-testid*='coupon']",
    "[class*='coupon']",
    "[class*='loyalty']",
    "[class*='fidelite']",
    "[class*='prime']",
    "[class*='cashback']",
    "[class*='odr']",
    "[class*='reprise']",
    "[class*='trade-in']",
    "[class*='bundle']",
    "[class*='pack']",
  ]);
  if (text === null) return { type: "public_price", label: null, accessibleToAll: true };
  const normalized = text.normalize("NFKD").replace(/\p{M}/gu, "").toLowerCase();
  const type = /(?:lot|pack|bundle).*(?:avec|comprend|inclut)|achetes?.*(?:offert|ensemble)/u.test(normalized)
    ? "bundle"
    : /reprise|trade[- ]?in/u.test(normalized)
    ? "trade_in"
    : /rembours|cashback|\bodr\b/u.test(normalized)
      ? "cashback"
      : /prime|membre|fidelite|carte/u.test(normalized)
        ? "membership"
        : /coupon|code promo|appliquer/u.test(normalized)
          ? "coupon"
          : "unknown";
  return { type, label: cleanText(text, 240), accessibleToAll: false };
}

function shippingMinor(value: string | null): number | null {
  if (value === null) return null;
  const normalized = value.normalize("NFKD").replace(/\p{M}/gu, "").toLowerCase();
  if (/\b(gratuit(?:e)?|gratuit[ao]|gratis|kostenlos|free delivery|free shipping)\b/u.test(normalized)) return 0;
  return parseMoneyMinor(value);
}

function availability(value: string | null): Availability {
  if (value === null) return "unknown";
  const normalized = value.normalize("NFKD").replace(/\p{M}/gu, "").toLowerCase();
  if (/indisponible|rupture|out of stock|nicht verfugbar|non disponibile|no disponible/u.test(normalized)) return "out_of_stock";
  if (/precommande|pre-order|vorbestell|preordine|preventa/u.test(normalized)) return "preorder";
  if (/en stock|in stock|auf lager|disponibile|disponibilita|disponible|add-to-cart|buy-now/u.test(normalized)) return "in_stock";
  return "unknown";
}

function condition(value: string | null): OfferSnapshot["condition"] {
  if (value === null) return "unknown";
  const normalized = value.normalize("NFKD").replace(/\p{M}/gu, "").toLowerCase();
  if (/recondition|refurbished|erneuert|ricondizionat|reacondicionad/u.test(normalized)) return "refurbished";
  if (/occasion|used|gebraucht|usato|usado/u.test(normalized)) return "used";
  if (/neuf|new|neu|nuovo|nuevo/u.test(normalized)) return "new";
  return "unknown";
}

function trustedSeller(source: RetailSource, value: string | null): boolean {
  if (value === null) return false;
  const normalized = value.normalize("NFKD").replace(/\p{M}/gu, "").toLowerCase().replace(/[^a-z0-9]/gu, "");
  const direct: Record<RetailSource, readonly string[]> = {
    boulanger: ["boulanger", "boulangercom"],
    darty: ["darty", "dartycom"],
    cdiscount: ["cdiscount", "cdiscountcom"],
    amazon: ["amazon", "amazonfr", "amazonde", "amazonit", "amazones", "amazoncouk"],
  };
  if (direct[source].includes(normalized)) return true;
  if (source !== "amazon") return false;
  return /(?:vendu(?: et expedie)? par|sold(?: and dispatched)? by|verkauf(?: und versand)? durch|venduto(?: e spedito)? da|vendido(?: y enviado)? por)\s*amazon\b/iu.test(value);
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
    ?? url.match(/\/(?:dp|gp\/product)\/([A-Z0-9]{10})(?:[/?]|$)/iu)?.[1]?.toUpperCase()
    ?? url.match(/(?:\/ref\/|\/f-)([A-Za-z0-9_-]+)/u)?.[1]
    ?? url;
  const referenceMinor = parseMoneyMinor(selectorValue($, connector.selectors.referencePrice));
  const shippingAmount = shippingMinor(selectorValue($, connector.selectors.shipping));
  const seller = selectorValue($, connector.selectors.seller);
  const offerAvailability = availability(selectorValue($, connector.selectors.availability));
  const offerCondition = condition(selectorValue($, connector.selectors.condition));

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
      category: selectorValue($, ["meta[property='product:category']", "[itemprop='category']"]),
      url,
      imageUrl: cleanText($("meta[property='og:image']").attr("content"), 2_048),
    },
    price: { amountMinor: priceMinor, currency: connector.currency },
    shipping: shippingAmount === null ? null : { amountMinor: shippingAmount, currency: connector.currency },
    total: shippingAmount === null ? null : { amountMinor: priceMinor + shippingAmount, currency: connector.currency },
    referencePrice: referenceMinor !== null && referenceMinor > priceMinor
      ? { amountMinor: referenceMinor, currency: connector.currency }
      : null,
    seller,
    sellerTrusted: trustedSeller(connector.source, seller),
    condition: offerCondition,
    availability: offerAvailability,
    observedAt: options.observedAt ?? new Date().toISOString(),
    strategy: "connector",
    fixture: options.fixture ?? false,
    promotion: promotionFromPage($),
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
  if (structured.length > 0) {
    const $ = cheerio.load(html);
    const promotion = promotionFromPage($);
    const category = selectorValue($, ["meta[property='product:category']", "[itemprop='category']"]);
    return structured.map((offer) => ({
      ...offer,
      product: { ...offer.product, category },
      promotion,
    }));
  }
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
