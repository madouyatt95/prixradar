import {
  cleanText,
  normalizeCurrency,
  normalizeProductUrl,
  parseMoneyMinor,
  productKey,
} from "../normalize.js";
import type {
  Availability,
  Currency,
  Market,
  OfferSnapshot,
  RetailSource,
} from "../types.js";

type JsonRecord = Record<string, unknown>;

export interface JsonLdContext {
  source: RetailSource;
  market: Market;
  currency: Currency;
  pageUrl: string;
  allowedHosts: ReadonlySet<string>;
  observedAt?: string;
  fixture?: boolean;
}

function isRecord(value: unknown): value is JsonRecord {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function values(value: unknown): unknown[] {
  return Array.isArray(value) ? value : value === undefined || value === null ? [] : [value];
}

function typeIncludes(value: unknown, expected: string): boolean {
  return values(value).some((entry) => typeof entry === "string" && entry.toLowerCase() === expected.toLowerCase());
}

function walkJsonLd(value: unknown, output: JsonRecord[]): void {
  if (Array.isArray(value)) {
    for (const entry of value) walkJsonLd(entry, output);
    return;
  }
  if (!isRecord(value)) return;
  if (typeIncludes(value["@type"], "Product")) output.push(value);
  if ("@graph" in value) walkJsonLd(value["@graph"], output);
}

function extractScripts(html: string): string[] {
  const scripts: string[] = [];
  const pattern = /<script\b([^>]*)>([\s\S]*?)<\/script\s*>/giu;
  for (const match of html.matchAll(pattern)) {
    const attributes = match[1] ?? "";
    if (!/\btype\s*=\s*["']application\/ld\+json(?:\s*;[^"']*)?["']/iu.test(attributes)) continue;
    const body = (match[2] ?? "").replace(/^\s*<!--|-->\s*$/gu, "").trim();
    if (body) scripts.push(body);
  }
  return scripts;
}

function availability(value: unknown): Availability {
  if (typeof value !== "string") return "unknown";
  const normalized = value.toLowerCase();
  if (normalized.includes("instock") || normalized.includes("limitedavailability")) return "in_stock";
  if (normalized.includes("outofstock") || normalized.includes("soldout")) return "out_of_stock";
  if (normalized.includes("preorder") || normalized.includes("presale")) return "preorder";
  return "unknown";
}

function firstText(...candidates: unknown[]): string | null {
  for (const candidate of candidates) {
    const text = cleanText(candidate);
    if (text) return text;
  }
  return null;
}

function brandName(value: unknown): string | null {
  if (typeof value === "string") return cleanText(value, 120);
  return isRecord(value) ? firstText(value.name) : null;
}

function imageUrl(value: unknown): string | null {
  const candidate = values(value)[0];
  const raw = typeof candidate === "string" ? candidate : isRecord(candidate) ? candidate.url : null;
  if (typeof raw !== "string") return null;
  try {
    const url = new URL(raw);
    return url.protocol === "https:" ? url.toString() : null;
  } catch {
    return null;
  }
}

function chooseOffer(value: unknown): JsonRecord | null {
  const offers = values(value).filter(isRecord);
  if (offers.length === 0) return null;
  return offers.find((offer) => parseMoneyMinor(offer.price ?? offer.lowPrice) !== null) ?? null;
}

function sellerName(value: unknown): string | null {
  if (typeof value === "string") return cleanText(value, 160);
  return isRecord(value) ? firstText(value.name) : null;
}

function isTrustedRetailSeller(source: RetailSource, seller: string | null): boolean {
  if (seller === null) return false;
  const normalized = seller.normalize("NFKD").replace(/\p{M}/gu, "").toLowerCase().replace(/[^a-z0-9]/gu, "");
  const expected: Partial<Record<RetailSource, readonly string[]>> = {
    boulanger: ["boulanger", "boulangercom"],
    darty: ["darty", "dartycom"],
    cdiscount: ["cdiscount", "cdiscountcom"],
    amazon: ["amazon", "amazonfr", "amazonde", "amazonit", "amazones", "amazoncouk"],
  };
  if (expected[source]?.includes(normalized)) return true;
  return source === "amazon"
    && /(?:vendu(?: et expedie)? par|sold(?: and dispatched)? by|verkauf(?: und versand)? durch|venduto(?: e spedito)? da|vendido(?: y enviado)? por)\s*amazon\b/iu.test(seller.normalize("NFKD").replace(/\p{M}/gu, ""));
}

function productUrl(raw: JsonRecord, offer: JsonRecord, context: JsonLdContext): string {
  const candidate = firstText(offer.url, raw.url) ?? context.pageUrl;
  const absolute = new URL(candidate, context.pageUrl).toString();
  return normalizeProductUrl(absolute, context.allowedHosts);
}

export function extractJsonLdOffers(html: string, context: JsonLdContext): OfferSnapshot[] {
  const rawProducts: JsonRecord[] = [];
  for (const script of extractScripts(html)) {
    try {
      walkJsonLd(JSON.parse(script) as unknown, rawProducts);
    } catch {
      // A malformed merchant block does not invalidate other independent blocks.
    }
  }

  const results: OfferSnapshot[] = [];
  for (const raw of rawProducts) {
    const offer = chooseOffer(raw.offers);
    const title = firstText(raw.name, raw.headline);
    if (!offer || !title) continue;

    const amountMinor = parseMoneyMinor(offer.price ?? offer.lowPrice);
    if (amountMinor === null || amountMinor <= 0) continue;
    const currency = normalizeCurrency(offer.priceCurrency, context.currency);
    const url = productUrl(raw, offer, context);
    const externalId = firstText(
      raw.sku,
      raw.productID,
      raw.gtin13,
      raw.gtin12,
      raw.gtin14,
      raw.mpn,
      url,
    );
    if (!externalId) continue;

    const referenceMinor = parseMoneyMinor(offer.highPrice ?? raw.highPrice);
    const shippingMinor = isRecord(offer.shippingDetails)
      && isRecord(offer.shippingDetails.shippingRate)
      ? parseMoneyMinor(offer.shippingDetails.shippingRate.value)
      : null;
    const shipping = shippingMinor === null ? null : { amountMinor: shippingMinor, currency };
    const seller = sellerName(offer.seller);

    results.push({
      product: {
        productKey: productKey({ source: context.source, market: context.market, externalId }),
        source: context.source,
        market: context.market,
        externalId,
        title,
        brand: brandName(raw.brand),
        model: firstText(raw.model, raw.mpn),
        gtin: firstText(raw.gtin13, raw.gtin12, raw.gtin14, raw.gtin8),
        url,
        imageUrl: imageUrl(raw.image),
      },
      price: { amountMinor, currency },
      shipping,
      total: shippingMinor === null ? null : { amountMinor: amountMinor + shippingMinor, currency },
      referencePrice: referenceMinor !== null && referenceMinor > amountMinor
        ? { amountMinor: referenceMinor, currency }
        : null,
      seller,
      sellerTrusted: isTrustedRetailSeller(context.source, seller),
      condition: typeof offer.itemCondition === "string" && offer.itemCondition.toLowerCase().includes("new")
        ? "new"
        : "unknown",
      availability: availability(offer.availability),
      observedAt: context.observedAt ?? new Date().toISOString(),
      strategy: "json-ld",
      fixture: context.fixture ?? false,
    });
  }
  return results;
}
