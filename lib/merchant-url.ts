import { sourceForHost, type ActiveSourceId } from "./source-registry";

export type SupportedMerchant = ActiveSourceId;

const AMAZON_MARKET: Record<string, string> = {
  "amazon.fr": "FR",
  "amazon.de": "DE",
  "amazon.it": "IT",
  "amazon.es": "ES",
  "amazon.co.uk": "GB",
};

export function parseMerchantUrl(raw: string): { url: string; source: SupportedMerchant; market: string } | null {
  let parsed: URL;
  try { parsed = new URL(raw); } catch { return null; }
  if (parsed.protocol !== "https:" || parsed.username || parsed.password || parsed.port) return null;
  parsed.hash = "";
  const tracking = new Set(["gclid", "fbclid", "msclkid", "ref", "tag"]);
  for (const key of [...parsed.searchParams.keys()]) {
    if (key.toLowerCase().startsWith("utm_") || tracking.has(key.toLowerCase())) parsed.searchParams.delete(key);
  }
  const hostname = parsed.hostname.toLowerCase().replace(/^www\./u, "");
  const source = sourceForHost(hostname);
  if (!source) return null;
  const amazonHost = source.id === "amazon"
    ? Object.keys(AMAZON_MARKET).find((host) => hostname === host || hostname.endsWith(`.${host}`))
    : null;
  return {
    url: parsed.toString(),
    source: source.id,
    market: amazonHost ? AMAZON_MARKET[amazonHost] : source.markets[0] ?? "FR",
  };
}

export function parseCoverageProductUrl(raw: string): {
  url: string;
  productKey: string;
  externalId: string;
  source: SupportedMerchant;
  market: string;
} | null {
  const merchant = parseMerchantUrl(raw);
  if (!merchant) return null;
  const parsed = new URL(merchant.url);
  const normalizedPath = parsed.pathname.replace(/\/{2,}/gu, "/").replace(/\/$/u, "");
  let identity: string | null = null;
  let externalId: string | null = null;

  if (merchant.source === "amazon") {
    const asin = /\/(?:dp|gp\/product)\/([A-Z0-9]{10})(?:[/?]|$)/iu.exec(normalizedPath)?.[1]?.toUpperCase() ?? null;
    if (asin) {
      identity = `asin:${asin.toLowerCase()}`;
      externalId = asin;
      parsed.pathname = `/dp/${asin}`;
      parsed.hostname = Object.entries(AMAZON_MARKET).find(([, market]) => market === merchant.market)?.[0] ?? parsed.hostname;
    }
  } else if (merchant.source === "boulanger") {
    const reference = /^\/ref\/([A-Za-z0-9_-]+)$/u.exec(normalizedPath)?.[1] ?? null;
    if (reference) {
      identity = `ref:${reference.toLowerCase()}`;
      externalId = reference;
      parsed.pathname = `/ref/${reference}`;
    }
  } else if (merchant.source === "darty" && /^\/nav\/achat\/.+\.html$/iu.test(normalizedPath)) {
    identity = `path:${normalizedPath.toLowerCase()}`;
    externalId = normalizedPath.toLowerCase();
    parsed.pathname = normalizedPath;
  } else if (merchant.source === "cdiscount" && /^\/.+\/f-\d+[a-z0-9-]*\.html$/iu.test(normalizedPath)) {
    identity = `path:${normalizedPath.toLowerCase()}`;
    externalId = normalizedPath.toLowerCase();
    parsed.pathname = normalizedPath;
  } else if (merchant.source === "fnac") {
    const directId = /^\/a(\d+)(?:\/|$)/u.exec(normalizedPath)?.[1] ?? null;
    const marketplaceId = /^\/mp(\d+)(?:\/|$)/u.exec(normalizedPath)?.[1] ?? null;
    if (directId) {
      externalId = `a${directId}`;
      identity = `ref:${externalId}`;
      parsed.pathname = normalizedPath;
    } else if (marketplaceId) {
      externalId = `mp${marketplaceId}`;
      identity = `ref:${externalId}`;
      parsed.pathname = normalizedPath;
    }
  } else if (merchant.source === "carrefour") {
    const gtin = /^\/p\/(?:.+-)?(\d{8,14})$/u.exec(normalizedPath)?.[1] ?? null;
    if (gtin) {
      externalId = gtin;
      identity = `gtin:${gtin}`;
      parsed.pathname = `/p/p-${gtin}`;
    }
  } else if (merchant.source === "leroy_merlin") {
    const reference = /-(\d{6,14})\.html$/u.exec(normalizedPath)?.[1] ?? null;
    if (reference && normalizedPath.startsWith("/produits/")) {
      externalId = reference;
      identity = `ref:${reference}`;
      parsed.pathname = normalizedPath;
    }
  } else if (merchant.source === "castorama") {
    const gtin = /\/([0-9]{8,14})_CAFR\.prd$/iu.exec(normalizedPath)?.[1] ?? null;
    if (gtin) {
      externalId = gtin;
      identity = `gtin:${gtin}`;
      parsed.pathname = normalizedPath;
    }
  } else if (merchant.source === "conforama") {
    const reference = /\/p\/([A-Z]\d+)$/iu.exec(normalizedPath)?.[1] ?? null;
    if (reference) {
      externalId = reference.toUpperCase();
      identity = `ref:${reference.toLowerCase()}`;
      parsed.pathname = normalizedPath;
    }
  } else if (merchant.source === "rueducommerce") {
    const reference = /^\/p\/([rm]\d+)\.html$/iu.exec(normalizedPath)?.[1] ?? null;
    if (reference) {
      externalId = reference.toLowerCase();
      identity = `ref:${externalId}`;
      parsed.pathname = `/p/${externalId}.html`;
    }
  }

  if (!identity || !externalId) return null;
  parsed.hostname = parsed.hostname.toLowerCase().replace(/^www\./u, "");
  parsed.search = "";
  parsed.hash = "";
  return {
    url: parsed.toString(),
    productKey: `${merchant.source}:${merchant.market.toLowerCase()}:${identity}`,
    externalId,
    source: merchant.source,
    market: merchant.market,
  };
}
