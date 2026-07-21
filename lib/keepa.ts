export const KEEPA_MARKETS = {
  GB: {
    domainId: 2,
    currency: "GBP",
    country: "Royaume-Uni",
    amazonHost: "www.amazon.co.uk",
  },
  DE: {
    domainId: 3,
    currency: "EUR",
    country: "Allemagne",
    amazonHost: "www.amazon.de",
  },
  FR: {
    domainId: 4,
    currency: "EUR",
    country: "France",
    amazonHost: "www.amazon.fr",
  },
  IT: {
    domainId: 8,
    currency: "EUR",
    country: "Italie",
    amazonHost: "www.amazon.it",
  },
  ES: {
    domainId: 9,
    currency: "EUR",
    country: "Espagne",
    amazonHost: "www.amazon.es",
  },
} as const;

export type KeepaMarket = keyof typeof KEEPA_MARKETS;
export type KeepaPriceKind = "buyBox" | "amazon" | "new" | "list";

export type KeepaHistoryPoint = {
  at: string;
  amountMinor: number | null;
};

export type KeepaPriceSummary = {
  selectedKind: Exclude<KeepaPriceKind, "list"> | null;
  currentMinor: number | null;
  buyBoxMinor: number | null;
  amazonMinor: number | null;
  newMinor: number | null;
  listMinor: number | null;
  average30Minor: number | null;
  average90Minor: number | null;
  discountVs90Percent: number | null;
};

export type KeepaProductSnapshot = {
  asin: string;
  title: string | null;
  brand: string | null;
  manufacturer: string | null;
  model: string | null;
  imageUrl: string | null;
  productUrl: string;
  market: {
    code: KeepaMarket;
    domainId: number;
    country: string;
    currency: "EUR" | "GBP";
  };
  prices: KeepaPriceSummary;
  history: {
    kind: Exclude<KeepaPriceKind, "list"> | null;
    points: KeepaHistoryPoint[];
    windowDays: 90;
  };
  timestamps: {
    trackingSince: string | null;
    listedSince: string | null;
    lastUpdate: string | null;
    lastPriceChange: string | null;
  };
};

export type NormalizedKeepaResponse = {
  product: KeepaProductSnapshot;
  keepa: {
    tokensLeft: number | null;
    refillInMs: number | null;
    refillRate: number | null;
  };
};

type UnknownRecord = Record<string, unknown>;

const PRICE_INDEX = {
  amazon: 0,
  new: 1,
  list: 4,
  buyBox: 18,
} as const satisfies Record<KeepaPriceKind, number>;

const SELECTABLE_PRICE_KINDS = ["buyBox", "amazon", "new"] as const;
const KEEPA_UNIX_OFFSET_MINUTES = 21_564_000;

function isRecord(value: unknown): value is UnknownRecord {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function finiteNumber(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function optionalText(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function arrayAt(value: unknown, index: number): unknown {
  return Array.isArray(value) ? value[index] : undefined;
}

/** Keepa stores money as integer minor units. Negative sentinels mean unavailable. */
export function normalizeKeepaPrice(value: unknown): number | null {
  const numeric = finiteNumber(value);
  if (numeric === null || numeric < 0) return null;
  return Math.round(numeric);
}

/** Keepa timestamps are minutes since 2011-01-01T00:00:00Z. */
export function keepaTimeToIso(value: unknown): string | null {
  const minutes = finiteNumber(value);
  if (minutes === null || minutes < 0) return null;

  const milliseconds = (minutes + KEEPA_UNIX_OFFSET_MINUTES) * 60_000;
  const date = new Date(milliseconds);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

export function normalizeAsin(value: string | null): string | null {
  if (value === null) return null;
  const normalized = value.trim().toUpperCase();
  return /^[A-Z0-9]{10}$/.test(normalized) ? normalized : null;
}

export function normalizeKeepaMarket(value: string | null): KeepaMarket | null {
  if (value === null) return null;
  const normalized = value.trim().toUpperCase();
  return normalized in KEEPA_MARKETS ? (normalized as KeepaMarket) : null;
}

export function parseKeepaHistory(value: unknown): KeepaHistoryPoint[] {
  if (!Array.isArray(value)) return [];

  const points: KeepaHistoryPoint[] = [];
  for (let index = 0; index + 1 < value.length; index += 2) {
    const at = keepaTimeToIso(value[index]);
    if (at === null) continue;

    points.push({
      at,
      amountMinor: normalizeKeepaPrice(value[index + 1]),
    });
  }

  return points;
}

function lastAvailablePrice(points: KeepaHistoryPoint[]): number | null {
  for (let index = points.length - 1; index >= 0; index -= 1) {
    if (points[index].amountMinor !== null) return points[index].amountMinor;
  }
  return null;
}

function priceAt(stats: UnknownRecord | null, field: "current" | "avg30" | "avg90", kind: KeepaPriceKind) {
  return normalizeKeepaPrice(arrayAt(stats?.[field], PRICE_INDEX[kind]));
}

function currentPriceOrHistory(
  stats: UnknownRecord | null,
  kind: Exclude<KeepaPriceKind, "list">,
  history: KeepaHistoryPoint[],
): number | null {
  const current = stats?.current;
  if (Array.isArray(current) && PRICE_INDEX[kind] < current.length) {
    // Keep an explicit Keepa negative sentinel as null: falling back here would
    // incorrectly present an old historical price as the current offer.
    return normalizeKeepaPrice(current[PRICE_INDEX[kind]]);
  }
  return lastAvailablePrice(history);
}

function imageUrlFromCsv(value: unknown): string | null {
  const firstImage = optionalText(value)?.split(",")[0]?.trim();
  if (!firstImage || !/^[A-Za-z0-9._-]+$/.test(firstImage)) return null;
  return `https://images-na.ssl-images-amazon.com/images/I/${firstImage}`;
}

function discountPercent(currentMinor: number | null, referenceMinor: number | null): number | null {
  if (currentMinor === null || referenceMinor === null || referenceMinor <= 0) return null;
  return Math.round((1 - currentMinor / referenceMinor) * 1_000) / 10;
}

function normalizeNonNegativeNumber(value: unknown): number | null {
  const numeric = finiteNumber(value);
  return numeric === null || numeric < 0 ? null : numeric;
}

export function normalizeKeepaResponse(
  payload: unknown,
  requestedAsin: string,
  market: KeepaMarket,
): NormalizedKeepaResponse | null {
  if (!isRecord(payload) || !Array.isArray(payload.products)) return null;

  const rawProduct = payload.products.find(
    (candidate) => isRecord(candidate) && optionalText(candidate.asin)?.toUpperCase() === requestedAsin,
  );
  if (!isRecord(rawProduct)) return null;

  const stats = isRecord(rawProduct.stats) ? rawProduct.stats : null;
  const csv = Array.isArray(rawProduct.csv) ? rawProduct.csv : [];

  const historyByKind = {
    buyBox: parseKeepaHistory(csv[PRICE_INDEX.buyBox]),
    amazon: parseKeepaHistory(csv[PRICE_INDEX.amazon]),
    new: parseKeepaHistory(csv[PRICE_INDEX.new]),
  };

  const currentByKind = {
    buyBox: currentPriceOrHistory(stats, "buyBox", historyByKind.buyBox),
    amazon: currentPriceOrHistory(stats, "amazon", historyByKind.amazon),
    new: currentPriceOrHistory(stats, "new", historyByKind.new),
  };

  const selectedKind = SELECTABLE_PRICE_KINDS.find((kind) => currentByKind[kind] !== null) ?? null;
  const historyKind =
    (selectedKind !== null && historyByKind[selectedKind].length > 0 ? selectedKind : null) ??
    SELECTABLE_PRICE_KINDS.find((kind) => historyByKind[kind].length > 0) ??
    null;

  const currentMinor = selectedKind === null ? null : currentByKind[selectedKind];
  const average30Minor = selectedKind === null ? null : priceAt(stats, "avg30", selectedKind);
  const average90Minor = selectedKind === null ? null : priceAt(stats, "avg90", selectedKind);
  const marketConfig = KEEPA_MARKETS[market];

  return {
    product: {
      asin: requestedAsin,
      title: optionalText(rawProduct.title),
      brand: optionalText(rawProduct.brand),
      manufacturer: optionalText(rawProduct.manufacturer),
      model: optionalText(rawProduct.model),
      imageUrl: imageUrlFromCsv(rawProduct.imagesCSV ?? rawProduct.imageCSV),
      productUrl: `https://${marketConfig.amazonHost}/dp/${requestedAsin}`,
      market: {
        code: market,
        domainId: marketConfig.domainId,
        country: marketConfig.country,
        currency: marketConfig.currency,
      },
      prices: {
        selectedKind,
        currentMinor,
        buyBoxMinor: currentByKind.buyBox,
        amazonMinor: currentByKind.amazon,
        newMinor: currentByKind.new,
        listMinor: priceAt(stats, "current", "list"),
        average30Minor,
        average90Minor,
        discountVs90Percent: discountPercent(currentMinor, average90Minor),
      },
      history: {
        kind: historyKind,
        points: historyKind === null ? [] : historyByKind[historyKind],
        windowDays: 90,
      },
      timestamps: {
        trackingSince: keepaTimeToIso(rawProduct.trackingSince),
        listedSince: keepaTimeToIso(rawProduct.listedSince),
        lastUpdate: keepaTimeToIso(rawProduct.lastUpdate),
        lastPriceChange: keepaTimeToIso(rawProduct.lastPriceChange),
      },
    },
    keepa: {
      tokensLeft: normalizeNonNegativeNumber(payload.tokensLeft),
      refillInMs: normalizeNonNegativeNumber(payload.refillIn),
      refillRate: normalizeNonNegativeNumber(payload.refillRate),
    },
  };
}

export type KeepaUpstreamErrorKind = "rate_limited" | "authentication" | "not_found" | "unknown";

export function classifyKeepaPayloadError(payload: unknown): KeepaUpstreamErrorKind | null {
  if (!isRecord(payload) || !isRecord(payload.error)) return null;

  const type = `${optionalText(payload.error.type) ?? ""} ${optionalText(payload.error.code) ?? ""}`.toLowerCase();
  if (type.includes("token") || type.includes("rate") || type.includes("quota")) return "rate_limited";
  if (type.includes("key") || type.includes("auth") || type.includes("access")) return "authentication";
  if (type.includes("notfound") || type.includes("not_found") || type.includes("product")) return "not_found";
  return "unknown";
}
