import { XMLParser } from "fast-xml-parser";

import { parseCoverageProductUrl } from "./merchant-url";
import { isPartnerSourceAuthorized } from "./source-registry";

const DEALABS_TREND_FEED = "https://www.dealabs.com/rss/tendance";
const MAX_FEED_BYTES = 768 * 1024;
const MAX_REDIRECT_BYTES = 192 * 1024;
const MAX_FEED_ITEMS = 40;
const SUPPORTED_MERCHANT_NAMES = new Set([
  "amazon",
  "boulanger",
  "carrefour",
  "castorama",
  "cdiscount",
  "conforama",
  "darty",
  "fnac",
  "jd sports",
  "jdsports",
  "leroy merlin",
  "rue du commerce",
]);

type RecordValue = Record<string, unknown>;

export type DealabsFeedItem = {
  externalId: string;
  title: string;
  merchant: string;
  category: string | null;
  dealUrl: string;
  imageUrl: string | null;
  currency: "EUR" | "GBP";
  priceCents: number | null;
  temperature: number;
  publishedAt: string;
};

type ExistingSignal = {
  id: string;
  merchantUrl: string | null;
  source: string | null;
  market: string | null;
  productId: string | null;
  temperature: number;
  lastSeenAt: string;
};

type SignalResolution = {
  merchantUrl: string;
  source: string;
  market: string;
  productId: string;
};

type DealabsSyncOptions = {
  now?: Date;
  fetcher?: typeof fetch;
  authorizedPartnerSources?: string;
};

function record(value: unknown): RecordValue | null {
  return value && typeof value === "object" && !Array.isArray(value) ? value as RecordValue : null;
}

function stringValue(value: unknown) {
  return typeof value === "string" ? value.trim() : typeof value === "number" ? String(value) : "";
}

function decodeHtmlEntities(value: string) {
  return value
    .replaceAll("&amp;", "&")
    .replaceAll("&quot;", "\"")
    .replaceAll("&#39;", "'")
    .replaceAll("&lt;", "<")
    .replaceAll("&gt;", ">");
}

function parseFrenchPrice(value: string) {
  const normalized = value.replace(/[\s\u00a0\u202f]/gu, "").replace(",", ".");
  const match = /-?\d+(?:\.\d{1,2})?/u.exec(normalized);
  if (!match) return null;
  const amount = Number(match[0]);
  return Number.isFinite(amount) && amount >= 0 ? Math.round(amount * 100) : null;
}

function parseDealabsUrl(value: string) {
  try {
    const url = new URL(decodeHtmlEntities(value));
    const host = url.hostname.toLowerCase().replace(/^www\./u, "");
    if (url.protocol !== "https:" || host !== "dealabs.com") return null;
    const externalId = /-(\d{5,12})\/?$/u.exec(url.pathname)?.[1] ?? null;
    if (!externalId || !/^\/(?:bons-plans|codes-promo)\//u.test(url.pathname)) return null;
    url.hash = "";
    url.search = "";
    return { externalId, url: url.toString() };
  } catch {
    return null;
  }
}

export function parseDealabsRss(xml: string): DealabsFeedItem[] {
  const parsed = new XMLParser({
    ignoreAttributes: false,
    attributeNamePrefix: "",
    parseTagValue: false,
    parseAttributeValue: false,
    trimValues: true,
  }).parse(xml) as unknown;
  const channel = record(record(parsed)?.rss)?.channel;
  const itemValue = record(channel)?.item;
  const items = Array.isArray(itemValue) ? itemValue : itemValue ? [itemValue] : [];
  const unique = new Map<string, DealabsFeedItem>();

  for (const candidate of items.slice(0, MAX_FEED_ITEMS)) {
    const item = record(candidate);
    if (!item) continue;
    const deal = parseDealabsUrl(stringValue(item.link) || stringValue(item.guid));
    const rawTitle = stringValue(item.title);
    const titleMatch = /^(-?\d+(?:[.,]\d+)?)°\s*-\s*(.+)$/u.exec(rawTitle);
    const merchant = record(item["pepper:merchant"]);
    const priceLabel = stringValue(merchant?.price);
    const publishedAtMs = Date.parse(stringValue(item.pubDate));
    if (!deal || !titleMatch || !Number.isFinite(publishedAtMs)) continue;
    const temperature = Math.max(0, Math.round(Number(titleMatch[1].replace(",", "."))));
    if (!Number.isFinite(temperature)) continue;
    const media = record(item["media:content"]) ?? record(item["media:thumbnail"]);
    const imageUrl = stringValue(media?.url);
    unique.set(deal.externalId, {
      externalId: deal.externalId,
      title: titleMatch[2].trim().slice(0, 300),
      merchant: (stringValue(merchant?.name) || "Marchand non précisé").slice(0, 120),
      category: stringValue(item.category).slice(0, 120) || null,
      dealUrl: deal.url,
      imageUrl: imageUrl.startsWith("https://") ? imageUrl.slice(0, 2_048) : null,
      currency: priceLabel.includes("£") ? "GBP" : "EUR",
      priceCents: parseFrenchPrice(priceLabel),
      temperature,
      publishedAt: new Date(publishedAtMs).toISOString(),
    });
  }
  return [...unique.values()];
}

async function readLimitedText(response: Response, maximumBytes: number) {
  if (!response.body) return "";
  const declared = Number(response.headers.get("content-length"));
  if (Number.isFinite(declared) && declared > maximumBytes) throw new Error("DEALABS_RESPONSE_TOO_LARGE");
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let size = 0;
  let result = "";
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > maximumBytes) throw new Error("DEALABS_RESPONSE_TOO_LARGE");
      result += decoder.decode(value, { stream: true });
    }
    return result + decoder.decode();
  } finally {
    reader.releaseLock();
  }
}

function supportedMerchantName(value: string) {
  return SUPPORTED_MERCHANT_NAMES.has(value.toLocaleLowerCase("fr").replace(/\s+/gu, " ").trim());
}

function metaRefreshTarget(body: string) {
  const tag = [...body.matchAll(/<meta\b[^>]*>/giu)]
    .map((match) => match[0])
    .find((value) => /\bhttp-equiv=["']refresh["']/iu.test(value));
  if (!tag) return null;
  const content = /\bcontent=(["'])(.*?)\1/iu.exec(tag)?.[2] ?? "";
  const marker = content.toLowerCase().indexOf("url=");
  if (marker < 0) return null;
  let target = content.slice(marker + 4).trim();
  if ((target.startsWith("'") && target.endsWith("'")) || (target.startsWith("\"") && target.endsWith("\""))) {
    target = target.slice(1, -1);
  }
  return target || null;
}

async function resolveMerchantProduct(externalId: string, fetcher: typeof fetch): Promise<SignalResolution | null> {
  const response = await fetcher(`https://www.dealabs.com/visit/threadmain/${encodeURIComponent(externalId)}`, {
    headers: { accept: "text/html,application/xhtml+xml" },
    redirect: "manual",
    signal: AbortSignal.timeout(8_000),
  });
  if (!response.ok && (response.status < 300 || response.status >= 400)) return null;
  const directLocation = response.headers.get("location");
  const body = directLocation ? "" : await readLimitedText(response, MAX_REDIRECT_BYTES);
  const refreshTarget = directLocation ?? metaRefreshTarget(body);
  if (!refreshTarget) return null;
  let target = decodeHtmlEntities(refreshTarget.trim());
  try {
    const redirect = new URL(target);
    if (redirect.hostname.toLowerCase() === "path.dealabs.com") target = redirect.searchParams.get("url") ?? "";
  } catch {
    return null;
  }
  const product = parseCoverageProductUrl(target);
  return product ? {
    merchantUrl: product.url,
    source: product.source,
    market: product.market,
    productId: product.externalId,
  } : null;
}

function placeholders(count: number) {
  return Array.from({ length: count }, () => "?").join(",");
}

function signalStatus(temperature: number, velocity: number, ageMinutes: number, previousTemperature?: number) {
  if (previousTemperature !== undefined && temperature < previousTemperature) return "cooling";
  if (temperature >= 100 && ageMinutes <= 45 && velocity >= 4) return "heating";
  if (temperature >= 100) return "hot";
  return "new";
}

async function existingSignals(database: D1Database, ids: string[]) {
  if (ids.length === 0) return new Map<string, ExistingSignal>();
  const result = await database.prepare(`
    SELECT id, merchant_url AS merchantUrl, source, market, product_id AS productId,
           temperature, last_seen_at AS lastSeenAt
    FROM community_signals WHERE id IN (${placeholders(ids.length)})
  `).bind(...ids).all<ExistingSignal>();
  return new Map((result.results ?? []).map((row) => [row.id, row]));
}

async function resolveNewProducts(
  items: DealabsFeedItem[],
  existing: Map<string, ExistingSignal>,
  fetcher: typeof fetch,
) {
  const candidates = items.filter((item) => {
    const previous = existing.get(`dealabs:${item.externalId}`);
    return !previous?.merchantUrl && (
      supportedMerchantName(item.merchant)
      || item.merchant === "Marchand à identifier"
    );
  }).slice(0, 10);
  const entries = await Promise.all(candidates.map(async (item) => {
    try {
      return [item.externalId, await resolveMerchantProduct(item.externalId, fetcher)] as const;
    } catch {
      return [item.externalId, null] as const;
    }
  }));
  return new Map(entries);
}

export async function storeDealabsItems(
  database: D1Database,
  items: DealabsFeedItem[],
  options: DealabsSyncOptions = {},
) {
  const nowDate = options.now ?? new Date();
  const now = nowDate.toISOString();
  const fetcher = options.fetcher ?? fetch;
  const ids = items.map((item) => `dealabs:${item.externalId}`);
  const existing = await existingSignals(database, ids);
  const resolved = await resolveNewProducts(items, existing, fetcher);
  const statements: D1PreparedStatement[] = [];
  let queued = 0;

  for (const item of items) {
    const id = `dealabs:${item.externalId}`;
    const previous = existing.get(id);
    const resolution = resolved.get(item.externalId) ?? (previous?.merchantUrl && previous.source && previous.market && previous.productId ? {
      merchantUrl: previous.merchantUrl,
      source: previous.source,
      market: previous.market,
      productId: previous.productId,
    } : null);
    const ageMinutes = Math.max(1, (nowDate.getTime() - Date.parse(item.publishedAt)) / 60_000);
    const elapsedMinutes = previous ? Math.max(1, (nowDate.getTime() - Date.parse(previous.lastSeenAt)) / 60_000) : ageMinutes;
    const velocity = previous
      ? Math.max(0, item.temperature - previous.temperature) / elapsedMinutes
      : item.temperature / ageMinutes;
    const velocityX100 = Math.max(0, Math.min(100_000, Math.round(velocity * 100)));
    const status = signalStatus(item.temperature, velocity, ageMinutes, previous?.temperature);
    let inspectionRequestId: string | null = null;

    if (resolution && isPartnerSourceAuthorized(resolution.source, options.authorizedPartnerSources)) {
      const heatBucket = Math.max(2, Math.floor(item.temperature / 50));
      inspectionRequestId = `inspect:dealabs:${item.externalId}:${heatBucket}`;
      statements.push(database.prepare(`
        INSERT INTO inspection_requests (
          id, owner_id, url, source, market, status, result_json, requested_at, updated_at
        ) VALUES (?, 'system:dealabs', ?, ?, ?, 'pending', '{}', ?, ?)
        ON CONFLICT(id) DO NOTHING
      `).bind(inspectionRequestId, resolution.merchantUrl, resolution.source, resolution.market, now, now));
      if (!previous || previous.temperature < heatBucket * 50) queued += 1;
    }

    statements.push(database.prepare(`
      INSERT INTO community_signals (
        id, provider, external_id, title, merchant, category, deal_url, merchant_url,
        image_url, source, market, product_id, currency, price_cents, temperature,
        velocity_x100, status, inspection_request_id, published_at, first_seen_at,
        last_seen_at, created_at, updated_at
      ) VALUES (?, 'dealabs', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(id) DO UPDATE SET
        title = excluded.title,
        merchant = excluded.merchant,
        category = excluded.category,
        deal_url = excluded.deal_url,
        merchant_url = coalesce(excluded.merchant_url, community_signals.merchant_url),
        image_url = coalesce(excluded.image_url, community_signals.image_url),
        source = coalesce(excluded.source, community_signals.source),
        market = coalesce(excluded.market, community_signals.market),
        product_id = coalesce(excluded.product_id, community_signals.product_id),
        currency = excluded.currency,
        price_cents = coalesce(excluded.price_cents, community_signals.price_cents),
        temperature = excluded.temperature,
        velocity_x100 = excluded.velocity_x100,
        status = excluded.status,
        inspection_request_id = coalesce(excluded.inspection_request_id, community_signals.inspection_request_id),
        last_seen_at = excluded.last_seen_at,
        updated_at = excluded.updated_at
    `).bind(
      id, item.externalId, item.title, item.merchant, item.category, item.dealUrl,
      resolution?.merchantUrl ?? null, item.imageUrl, resolution?.source ?? null,
      resolution?.market ?? null, resolution?.productId ?? null, item.currency,
      item.priceCents, item.temperature, velocityX100, status, inspectionRequestId,
      item.publishedAt, now, now, now, now,
    ));
    if (!previous || previous.temperature !== item.temperature) {
      statements.push(database.prepare(`
        INSERT OR IGNORE INTO community_signal_observations (signal_id, temperature, observed_at)
        VALUES (?, ?, ?)
      `).bind(id, item.temperature, now));
    }
  }

  if (statements.length > 0) await database.batch(statements);
  const staleBefore = new Date(nowDate.getTime() - 12 * 60 * 60_000).toISOString();
  const observationBefore = new Date(nowDate.getTime() - 14 * 24 * 60 * 60_000).toISOString();
  await database.batch([
    database.prepare("UPDATE community_signals SET status='stale', updated_at=? WHERE last_seen_at < ? AND status != 'stale'").bind(now, staleBefore),
    database.prepare("DELETE FROM community_signal_observations WHERE observed_at < ?").bind(observationBefore),
  ]);
  return { seen: items.length, queued };
}

export async function syncDealabsTrend(database: D1Database, options: DealabsSyncOptions = {}) {
  const fetcher = options.fetcher ?? fetch;
  const response = await fetcher(DEALABS_TREND_FEED, {
    headers: { accept: "application/rss+xml, application/xml;q=0.9, text/xml;q=0.8" },
    redirect: "follow",
    signal: AbortSignal.timeout(12_000),
  });
  if (!response.ok) throw new Error(`DEALABS_FEED_${response.status}`);
  const xml = await readLimitedText(response, MAX_FEED_BYTES);
  const items = parseDealabsRss(xml);
  if (items.length === 0) throw new Error("DEALABS_FEED_EMPTY");
  return storeDealabsItems(database, items, options);
}

export function dealabsItemsFromEmail(subject: string, text: string, html: string): DealabsFeedItem[] {
  const combined = `${subject}\n${text}\n${html}`;
  const links = combined.match(/https:\/\/(?:www\.)?dealabs\.com\/(?:bons-plans|codes-promo)\/[^\s<>"']+/giu) ?? [];
  const title = subject.replace(/^.*?(?:Dealabs|alerte)\s*[:\-–]?\s*/iu, "").trim() || "Nouveau signal Dealabs";
  const priceLabel = /\b\d[\d\s.,]*(?:€|£)\b/u.exec(combined)?.[0] ?? "";
  const temperatureLabel = /(-?\d+(?:[.,]\d+)?)°/u.exec(combined)?.[1] ?? "0";
  const now = new Date().toISOString();
  const items = new Map<string, DealabsFeedItem>();
  for (const link of links) {
    const parsed = parseDealabsUrl(link.replace(/[),.;]+$/u, ""));
    if (!parsed) continue;
    items.set(parsed.externalId, {
      externalId: parsed.externalId,
      title: title.slice(0, 300),
      merchant: "Marchand à identifier",
      category: null,
      dealUrl: parsed.url,
      imageUrl: null,
      currency: priceLabel.includes("£") ? "GBP" : "EUR",
      priceCents: parseFrenchPrice(priceLabel),
      temperature: Math.max(0, Math.round(Number(temperatureLabel.replace(",", "."))) || 0),
      publishedAt: now,
    });
  }
  return [...items.values()];
}
