import { stableHash } from "./normalize.js";
import { scoreOffer } from "./scoring.js";
import type {
  Currency,
  Market,
  OfferSnapshot,
  TrustedHistoricalPrice,
  VerifiedObservation,
} from "./types.js";

type JsonRecord = Record<string, unknown>;

export const KEEPA_MARKETS = {
  GB: { domainId: 2, currency: "GBP", host: "www.amazon.co.uk" },
  DE: { domainId: 3, currency: "EUR", host: "www.amazon.de" },
  FR: { domainId: 4, currency: "EUR", host: "www.amazon.fr" },
  IT: { domainId: 8, currency: "EUR", host: "www.amazon.it" },
  ES: { domainId: 9, currency: "EUR", host: "www.amazon.es" },
} as const satisfies Record<Market, { domainId: number; currency: Currency; host: string }>;

const KEEPA_UNIX_OFFSET_MINUTES = 21_564_000;
const PRICE_INDEXES = { amazon: 0, new: 1, list: 4, buyBox: 18 } as const;

export interface KeepaQuota {
  tokensLeft: number | null;
  refillInMs: number | null;
  refillRate: number | null;
}

export interface KeepaDeal {
  asin: string;
  currentMinor: number | null;
  lastUpdate: string | null;
  rawDeltaPercent: number | null;
}

export interface KeepaProduct {
  asin: string;
  gtin: string | null;
  title: string;
  brand: string | null;
  model: string | null;
  imageUrl: string | null;
  currentMinor: number;
  referenceMinor: number | null;
  referenceSource: "keepa_average" | "keepa_list" | "unknown";
  market: Market;
  observedAt: string;
  buyBoxIsAmazon: boolean;
  buyBoxIsFba: boolean;
  buyBoxSellerId: string | null;
  history: TrustedHistoricalPrice[];
  categoryPath: string[];
  productGroup: string | null;
}

export type AmazonExcludedFamily = "books" | "music" | "media" | "wall_art";
export const DEFAULT_AMAZON_EXCLUDED_FAMILIES: readonly AmazonExcludedFamily[] = ["books", "music", "media", "wall_art"];

const EXCLUDED_CATEGORY_IDS: Partial<Record<Market, Partial<Record<AmazonExcludedFamily, readonly number[]>>>> = {
  // Amazon.fr root browse nodes. The text classifier below remains the
  // authority for products returned outside a root or under a generic node.
  FR: {
    books: [468256, 69_633_011, 672_109_031],
    music: [537366, 206_442_031],
    media: [578608],
  },
};

export function excludedCategoryIdsFor(
  market: Market,
  families: readonly AmazonExcludedFamily[],
): number[] {
  const marketIds = EXCLUDED_CATEGORY_IDS[market] ?? {};
  return [...new Set(families.flatMap((family) => marketIds[family] ?? []))];
}

function normalizedCategoryText(value: string) {
  return value.normalize("NFKD").replace(/\p{M}/gu, "").toLowerCase().replace(/[^a-z0-9]+/gu, " ").trim();
}

export function isExcludedAmazonProduct(
  product: Pick<KeepaProduct, "title" | "categoryPath" | "productGroup">,
  families: readonly AmazonExcludedFamily[],
): boolean {
  const familySet = new Set(families);
  const category = normalizedCategoryText([...product.categoryPath, product.productGroup ?? ""].join(" "));
  const title = normalizedCategoryText(product.title);
  const searchable = `${category} ${title}`;
  if (familySet.has("books") && /\b(?:book|books|livre|livres|roman|romans|buch|bucher|libro|libri|libros|kindle)\b/u.test(searchable)) return true;
  if (familySet.has("music") && /\b(?:music|musique|musik|musica|vinyl|vinyle|vinili|cds?|album audio|import allemand)\b/u.test(searchable)) return true;
  if (familySet.has("media") && /\b(?:dvd|blu ray|bluray|vhs|film|films|serie tv|series tv|video)\b/u.test(searchable)) return true;
  if (familySet.has("wall_art") && /\b(?:wall art|art mural|decoration murale|tableau|tableaux|poster|posters|affiche|affiches|toile|toiles|canvas print|kunstdruck|arte da parete|cuadro|cuadros)\b/u.test(searchable)) return true;
  return false;
}

export interface KeepaClientOptions {
  apiKey: string;
  timeoutMs?: number;
  maxQuotaWaitMs?: number;
  fetchImpl?: typeof fetch;
  sleep?: (milliseconds: number) => Promise<void>;
}

export class KeepaApiError extends Error {
  override name = "KeepaApiError";
  constructor(
    message: string,
    readonly code: "configuration" | "quota" | "authentication" | "upstream" | "timeout",
    readonly retryAfterMs: number | null = null,
  ) {
    super(message);
  }
}

function isRecord(value: unknown): value is JsonRecord {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function finite(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function nonNegative(value: unknown): number | null {
  const number = finite(value);
  return number !== null && number >= 0 ? number : null;
}

function keepaPrice(value: unknown): number | null {
  const number = finite(value);
  return number !== null && number > 0 ? Math.round(number) : null;
}

function text(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim().slice(0, 500) : null;
}

function arrayPrice(value: unknown, index: number): number | null {
  return Array.isArray(value) ? keepaPrice(value[index]) : null;
}

function keepaTime(value: unknown): string | null {
  const minutes = nonNegative(value);
  if (minutes === null) return null;
  const date = new Date((minutes + KEEPA_UNIX_OFFSET_MINUTES) * 60_000);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

function normalizedAsin(value: unknown): string | null {
  const asin = text(value)?.toUpperCase() ?? "";
  return /^[A-Z0-9]{10}$/u.test(asin) ? asin : null;
}

function normalizedGtin(value: unknown): string | null {
  const digits = text(value)?.replace(/\D/gu, "") ?? "";
  if (![8, 12, 13, 14].includes(digits.length)) return null;
  const body = digits.slice(0, -1);
  let sum = 0;
  for (let index = body.length - 1, position = 0; index >= 0; index -= 1, position += 1) {
    sum += Number(body[index]) * (position % 2 === 0 ? 3 : 1);
  }
  return (10 - (sum % 10)) % 10 === Number(digits.at(-1)) ? digits : null;
}

function productGtin(raw: JsonRecord, requestedCode: string | null) {
  const requested = normalizedGtin(requestedCode);
  if (requested) return requested;
  const candidates = [raw.eanList, raw.gtinList, raw.upcList]
    .flatMap((value) => Array.isArray(value) ? value : []);
  return candidates.map(normalizedGtin).find((value): value is string => value !== null) ?? null;
}

function quotaFromPayload(payload: JsonRecord): KeepaQuota {
  return {
    tokensLeft: nonNegative(payload.tokensLeft),
    refillInMs: nonNegative(payload.refillIn),
    refillRate: nonNegative(payload.refillRate),
  };
}

function dealRows(payload: JsonRecord): unknown[] {
  if (Array.isArray(payload.deals)) return payload.deals;
  if (isRecord(payload.deals) && Array.isArray(payload.deals.dr)) return payload.deals.dr;
  if (Array.isArray(payload.dealObjects)) return payload.dealObjects;
  return [];
}

function dealCurrentPrice(row: JsonRecord): number | null {
  if (!Array.isArray(row.current)) return keepaPrice(row.current);
  if (row.current.length > PRICE_INDEXES.buyBox) {
    return arrayPrice(row.current, PRICE_INDEXES.buyBox)
      ?? arrayPrice(row.current, PRICE_INDEXES.amazon)
      ?? arrayPrice(row.current, PRICE_INDEXES.new);
  }
  return row.current.map(keepaPrice).find((value) => value !== null) ?? null;
}

function normalizeDeals(payload: JsonRecord): KeepaDeal[] {
  const deals: KeepaDeal[] = [];
  for (const candidate of dealRows(payload)) {
    if (!isRecord(candidate)) continue;
    const asin = normalizedAsin(candidate.asin);
    if (!asin) continue;
    deals.push({
      asin,
      currentMinor: dealCurrentPrice(candidate),
      lastUpdate: keepaTime(candidate.lastUpdate ?? candidate.creationDate),
      rawDeltaPercent: finite(candidate.deltaPercent),
    });
  }
  return deals;
}

function buyBoxHistoryLast(value: unknown): number | null {
  if (!Array.isArray(value)) return null;
  // Like every Keepa price CSV, BUY_BOX_SHIPPING is a sequence of
  // [Keepa minute, landed price]. The price already includes shipping.
  for (let index = value.length - 2; index >= 0; index -= 2) {
    const price = keepaPrice(value[index + 1]);
    if (price !== null) return price;
  }
  return null;
}

function normalizeBuyBoxHistory(value: unknown, asin: string, observedAt: string): TrustedHistoricalPrice[] {
  if (!Array.isArray(value)) return [];
  const currentTimestamp = Date.parse(observedAt);
  const minimumTimestamp = currentTimestamp - 180 * 86_400_000;
  const history: TrustedHistoricalPrice[] = [];
  const seen = new Set<string>();
  // Keepa CSV index 18 is encoded as [time, landed price]. Treating it as a
  // three-value tuple would accidentally add the next timestamp to the price
  // and create impossible historical baselines.
  for (let index = 0; index + 1 < value.length; index += 2) {
    const pointObservedAt = keepaTime(value[index]);
    const priceMinor = keepaPrice(value[index + 1]);
    if (!pointObservedAt || priceMinor === null) continue;
    const timestamp = Date.parse(pointObservedAt);
    if (timestamp >= currentTimestamp || timestamp < minimumTimestamp) continue;
    const rawHash = stableHash(["keepa", asin, pointObservedAt, priceMinor]);
    if (seen.has(rawHash)) continue;
    seen.add(rawHash);
    history.push({ provider: "keepa", priceMinor, observedAt: pointObservedAt, rawHash });
  }
  return history
    .sort((left, right) => Date.parse(right.observedAt) - Date.parse(left.observedAt))
    .slice(0, 60);
}

function normalizeProduct(raw: JsonRecord, market: Market, observedAt: string, requestedCode: string | null = null): KeepaProduct | null {
  const asin = normalizedAsin(raw.asin);
  const title = text(raw.title);
  if (!asin || !title) return null;
  const stats = isRecord(raw.stats) ? raw.stats : null;
  const csv = Array.isArray(raw.csv) ? raw.csv : [];
  const current = stats?.current;
  // stats.current[18] is Keepa's Buy Box price including shipping. Do not
  // fall back to price types whose shipping component is unknown.
  const currentMinor = arrayPrice(current, PRICE_INDEXES.buyBox)
    ?? buyBoxHistoryLast(csv[PRICE_INDEXES.buyBox]);
  if (currentMinor === null) return null;

  const avg90 = stats?.avg90;
  const averageReference = arrayPrice(avg90, PRICE_INDEXES.buyBox);
  const listReference = arrayPrice(current, PRICE_INDEXES.list);
  const referenceMinor = averageReference ?? listReference;
  const referenceSource = averageReference !== null
    ? "keepa_average" as const
    : listReference !== null
      ? "keepa_list" as const
      : "unknown" as const;
  const imageName = text(raw.imagesCSV ?? raw.imageCSV)?.split(",")[0]?.trim() ?? null;
  const historySeries = csv[PRICE_INDEXES.buyBox];
  const categoryPath = (Array.isArray(raw.categoryTree) ? raw.categoryTree : [])
    .flatMap((entry): string[] => isRecord(entry) && text(entry.name) ? [text(entry.name) as string] : [])
    .slice(0, 20);

  return {
    asin,
    gtin: productGtin(raw, requestedCode),
    title,
    brand: text(raw.brand),
    model: text(raw.model ?? raw.mpn),
    imageUrl: imageName && /^[A-Za-z0-9._-]+$/u.test(imageName)
      ? `https://images-na.ssl-images-amazon.com/images/I/${imageName}`
      : null,
    currentMinor,
    referenceMinor: referenceMinor !== null && referenceMinor > currentMinor ? referenceMinor : null,
    referenceSource: referenceMinor !== null && referenceMinor > currentMinor ? referenceSource : "unknown",
    market,
    observedAt,
    buyBoxIsAmazon: stats?.buyBoxIsAmazon === true || raw.buyBoxIsAmazon === true,
    buyBoxIsFba: stats?.buyBoxIsFBA === true,
    buyBoxSellerId: text(stats?.buyBoxSellerId),
    history: normalizeBuyBoxHistory(historySeries, asin, observedAt),
    categoryPath,
    productGroup: text(raw.productGroup),
  };
}

export class KeepaClient {
  readonly #apiKey: string;
  readonly #timeoutMs: number;
  readonly #maxQuotaWaitMs: number;
  readonly #fetch: typeof fetch;
  readonly #sleep: (milliseconds: number) => Promise<void>;
  #quota: KeepaQuota = { tokensLeft: null, refillInMs: null, refillRate: null };
  #quotaObservedAt = 0;

  constructor(options: KeepaClientOptions) {
    if (!options.apiKey.trim()) throw new KeepaApiError("KEEPA_API_KEY absente.", "configuration");
    this.#apiKey = options.apiKey.trim();
    this.#timeoutMs = options.timeoutMs ?? 15_000;
    this.#maxQuotaWaitMs = options.maxQuotaWaitMs ?? 60_000;
    this.#fetch = options.fetchImpl ?? fetch;
    this.#sleep = options.sleep ?? ((milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds)));
  }

  get quota(): KeepaQuota {
    return { ...this.#quota };
  }

  async #waitForQuota(): Promise<void> {
    if (this.#quota.tokensLeft === null || this.#quota.tokensLeft > 0 || this.#quota.refillInMs === null) return;
    const elapsed = Date.now() - this.#quotaObservedAt;
    const waitMs = Math.max(0, this.#quota.refillInMs - elapsed) + 25;
    if (waitMs > this.#maxQuotaWaitMs) {
      throw new KeepaApiError("Quota Keepa épuisé; tâche à différer.", "quota", waitMs);
    }
    await this.#sleep(waitMs);
  }

  async #request(path: "/deal" | "/product", params: Record<string, string>): Promise<JsonRecord> {
    await this.#waitForQuota();
    const url = new URL(path, "https://api.keepa.com");
    url.search = new URLSearchParams({ key: this.#apiKey, ...params }).toString();
    for (let quotaAttempt = 0; quotaAttempt < 2; quotaAttempt += 1) {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), this.#timeoutMs);
      try {
        const response = await this.#fetch(url, {
          headers: { Accept: "application/json" },
          signal: controller.signal,
        });
        if (response.status === 401 || response.status === 403) {
          throw new KeepaApiError("Authentification Keepa refusée.", "authentication");
        }
        if (response.status === 429) {
          const retrySeconds = Number(response.headers.get("retry-after"));
          const retryAfterMs = Number.isFinite(retrySeconds) && retrySeconds > 0
            ? retrySeconds * 1_000
            : 60_000;
          if (quotaAttempt === 0 && retryAfterMs <= this.#maxQuotaWaitMs) {
            await this.#sleep(retryAfterMs + 25);
            continue;
          }
          throw new KeepaApiError("Quota Keepa temporairement épuisé.", "quota", retryAfterMs);
        }
        if (!response.ok) throw new KeepaApiError(`Keepa indisponible (HTTP ${response.status}).`, "upstream");

        const payload: unknown = await response.json();
        if (!isRecord(payload)) throw new KeepaApiError("Réponse Keepa invalide.", "upstream");
        this.#quota = quotaFromPayload(payload);
        this.#quotaObservedAt = Date.now();
        if (isRecord(payload.error)) {
          throw new KeepaApiError("Keepa a refusé la requête.", "upstream");
        }
        return payload;
      } catch (error) {
        if (error instanceof KeepaApiError) throw error;
        if (error instanceof Error && error.name === "AbortError") {
          throw new KeepaApiError("Délai Keepa dépassé.", "timeout");
        }
        throw new KeepaApiError("Échec réseau Keepa.", "upstream");
      } finally {
        clearTimeout(timeout);
      }
    }
    throw new KeepaApiError("Quota Keepa temporairement épuisé.", "quota");
  }

  async deals(market: Market, options: {
    page?: number;
    minimumDropPercent?: number;
    categoryIds?: readonly number[];
    minPriceCents?: number;
    maxPriceCents?: number;
    excludedCategoryIds?: readonly number[];
  } = {}): Promise<KeepaDeal[]> {
    const config = KEEPA_MARKETS[market];
    const minPriceCents = Math.max(1, Math.round(options.minPriceCents ?? 1));
    const maxPriceCents = Math.max(minPriceCents, Math.round(options.maxPriceCents ?? 100_000_000));
    const selection = {
      page: options.page ?? 0,
      domainId: config.domainId,
      includeCategories: [...new Set(options.categoryIds ?? [])]
        .filter((value) => Number.isSafeInteger(value) && value > 0)
        .slice(0, 20),
      excludeCategories: [...new Set(options.excludedCategoryIds ?? [])]
        .filter((value) => Number.isSafeInteger(value) && value > 0)
        .slice(0, 20),
      priceTypes: [PRICE_INDEXES.buyBox],
      deltaPercentRange: [options.minimumDropPercent ?? 30, 100],
      currentRange: [minPriceCents, maxPriceCents],
      isRangeEnabled: true,
      isLowest: true,
      sortType: 4,
      dateRange: 0,
    };
    const payload = await this.#request("/deal", { selection: JSON.stringify(selection) });
    return normalizeDeals(payload);
  }

  async products(market: Market, asins: readonly string[]): Promise<KeepaProduct[]> {
    const unique = [...new Set(asins.map((asin) => normalizedAsin(asin)).filter((asin): asin is string => asin !== null))];
    if (unique.length === 0) return [];
    if (unique.length > 100) throw new KeepaApiError("Keepa accepte au maximum 100 ASIN par lot.", "configuration");
    const observedAt = new Date().toISOString();
    const payload = await this.#request("/product", {
      domain: String(KEEPA_MARKETS[market].domainId),
      asin: unique.join(","),
      history: "1",
      days: "90",
      stats: "90",
      buybox: "1",
      update: "1",
    });
    const rows = Array.isArray(payload.products) ? payload.products : [];
    return rows
      .map((row) => isRecord(row) ? normalizeProduct(row, market, observedAt) : null)
      .filter((product): product is KeepaProduct => product !== null);
  }

  async productsByCodes(market: Market, codes: readonly string[]): Promise<KeepaProduct[]> {
    const unique = [...new Set(codes.map(normalizedGtin).filter((code): code is string => code !== null))];
    if (unique.length === 0) return [];
    if (unique.length > 100) throw new KeepaApiError("Keepa accepte au maximum 100 codes produit par lot.", "configuration");
    const observedAt = new Date().toISOString();
    const payload = await this.#request("/product", {
      domain: String(KEEPA_MARKETS[market].domainId),
      code: unique.join(","),
      history: "1",
      days: "90",
      stats: "90",
      buybox: "1",
      update: "1",
    });
    const rows = Array.isArray(payload.products) ? payload.products : [];
    return rows
      .map((row) => isRecord(row) ? normalizeProduct(row, market, observedAt, unique.length === 1 ? unique[0] ?? null : null) : null)
      .filter((product): product is KeepaProduct => product !== null);
  }
}

export function keepaOffer(product: KeepaProduct, fixture = false): OfferSnapshot {
  const market = KEEPA_MARKETS[product.market];
  return {
    product: {
      productKey: `amazon:${product.market.toLowerCase()}:${product.asin}`,
      source: "amazon",
      market: product.market,
      externalId: product.asin,
      title: product.title,
      brand: product.brand,
      model: product.model,
      gtin: product.gtin,
      category: product.categoryPath.at(-1) ?? product.productGroup,
      url: `https://${market.host}/dp/${product.asin}`,
      imageUrl: product.imageUrl,
    },
    // Keepa index 18 is already a landed Buy Box price. It is normalized as
    // the public price plus zero residual shipping; no claim is made that the
    // merchant itself labels delivery as free.
    price: { amountMinor: product.currentMinor, currency: market.currency },
    shipping: { amountMinor: 0, currency: market.currency },
    total: { amountMinor: product.currentMinor, currency: market.currency },
    referencePrice: product.referenceMinor === null
      ? null
      : { amountMinor: product.referenceMinor, currency: market.currency },
    referencePriceSource: product.referenceSource,
    seller: product.buyBoxIsAmazon
      ? "Amazon"
      : product.buyBoxSellerId
        ? `Vendeur tiers Amazon · ${product.buyBoxSellerId}`
        : "Vendeur tiers Amazon",
    sellerTrusted: product.buyBoxIsAmazon,
    condition: "new",
    availability: "in_stock",
    observedAt: product.observedAt,
    strategy: "keepa",
    fixture,
    promotion: { type: "public_price", label: null, accessibleToAll: true },
    sellerSignals: {
      ratingPercent: null,
      reviewCount: null,
      fulfillment: product.buyBoxIsAmazon ? "direct" : product.buyBoxIsFba ? "platform" : "merchant",
      country: null,
      warranty: null,
      returns: null,
    },
  };
}

export function verifyKeepaDeal(deal: KeepaDeal, product: KeepaProduct, fixture = false): VerifiedObservation {
  const offer: OfferSnapshot = {
    ...keepaOffer(product, fixture),
    variantIdentity: {
      expectedId: `asin:${deal.asin.toLowerCase()}`,
      observedId: `asin:${product.asin.toLowerCase()}`,
      expectedSource: "keepa_deal",
      observedSource: "keepa_product",
      merchantProductId: product.asin.toLowerCase(),
      gtin: product.gtin,
      selectedOptions: {},
    },
  };
  const matchingIdentity = deal.asin === product.asin;
  const matchingPrice = deal.currentMinor === null || deal.currentMinor === product.currentMinor;
  const anomaly = scoreOffer(offer, product.referenceMinor);
  return {
    schemaVersion: "1",
    alertCandidateId: offer.product.productKey,
    offer,
    verification: {
      status: matchingIdentity && matchingPrice ? "confirmed" : "rejected",
      firstObservedAt: deal.lastUpdate ?? product.observedAt,
      secondObservedAt: product.observedAt,
      matchingIdentity,
      matchingPrice,
    },
    anomaly,
    historicalPrices: product.history,
  };
}

export function verifyKeepaCodeProduct(product: KeepaProduct, fixture = false): VerifiedObservation {
  return verifyKeepaDeal({
    asin: product.asin,
    currentMinor: product.currentMinor,
    lastUpdate: product.observedAt,
    rawDeltaPercent: null,
  }, product, fixture);
}

export function mergeKeepaWithLive(
  keepaObservation: VerifiedObservation,
  liveObservation: VerifiedObservation,
): VerifiedObservation {
  const keepaOfferSnapshot = keepaObservation.offer;
  const liveOffer = liveObservation.offer;
  const matchingIdentity = keepaOfferSnapshot.product.externalId === liveOffer.product.externalId
    && keepaOfferSnapshot.product.market === liveOffer.product.market;
  const matchingPrice = keepaOfferSnapshot.price.currency === liveOffer.price.currency
    && keepaOfferSnapshot.price.amountMinor === liveOffer.price.amountMinor;
  const offer: OfferSnapshot = {
    ...liveOffer,
    product: {
      ...liveOffer.product,
      title: liveOffer.product.title || keepaOfferSnapshot.product.title,
      brand: liveOffer.product.brand ?? keepaOfferSnapshot.product.brand,
      model: liveOffer.product.model ?? keepaOfferSnapshot.product.model,
      gtin: liveOffer.product.gtin ?? keepaOfferSnapshot.product.gtin,
      imageUrl: liveOffer.product.imageUrl ?? keepaOfferSnapshot.product.imageUrl,
    },
    referencePrice: liveOffer.referencePrice ?? keepaOfferSnapshot.referencePrice,
    referencePriceSource: liveOffer.referencePrice
      ? "merchant_page"
      : keepaOfferSnapshot.referencePriceSource ?? "unknown",
    fixture: keepaOfferSnapshot.fixture || liveOffer.fixture,
  };
  return {
    schemaVersion: "1",
    alertCandidateId: offer.product.productKey,
    offer,
    verification: {
      status: keepaObservation.verification.status === "confirmed"
        && liveObservation.verification.status === "confirmed"
        && matchingIdentity
        && matchingPrice
        ? "confirmed"
        : "rejected",
      firstObservedAt: keepaObservation.verification.firstObservedAt,
      secondObservedAt: liveObservation.verification.secondObservedAt,
      matchingIdentity,
      matchingPrice,
    },
    anomaly: scoreOffer(offer, keepaOfferSnapshot.referencePrice?.amountMinor ?? null),
    ...(keepaObservation.historicalPrices
      ? { historicalPrices: keepaObservation.historicalPrices }
      : {}),
  };
}

export async function scanKeepaMarket(
  client: KeepaClient,
  market: Market,
  options: {
    page?: number;
    limit?: number;
    minimumDropPercent?: number;
    fixture?: boolean;
    categoryIds?: readonly number[];
    minPriceCents?: number;
    maxPriceCents?: number;
    excludedFamilies?: readonly AmazonExcludedFamily[];
  } = {},
): Promise<VerifiedObservation[]> {
  const excludedFamilies = options.excludedFamilies ?? DEFAULT_AMAZON_EXCLUDED_FAMILIES;
  const deals = (await client.deals(market, {
    ...options,
    excludedCategoryIds: excludedCategoryIdsFor(market, excludedFamilies),
  })).slice(0, options.limit ?? 50);
  if (deals.length === 0) return [];
  const products = await client.products(market, deals.map((deal) => deal.asin));
  const byAsin = new Map(products
    .filter((product) => !isExcludedAmazonProduct(product, excludedFamilies))
    .map((product) => [product.asin, product]));
  return deals.flatMap((deal) => {
    const product = byAsin.get(deal.asin);
    return product ? [verifyKeepaDeal(deal, product, options.fixture ?? false)] : [];
  });
}
