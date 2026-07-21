import { createHash } from "node:crypto";

import type { Currency, Market, RetailSource } from "./types.js";

const TRACKING_PARAMETERS = new Set([
  "gclid",
  "fbclid",
  "msclkid",
  "ref",
  "tag",
]);

export function cleanText(value: unknown, maxLength = 500): string | null {
  if (typeof value !== "string") return null;
  const cleaned = value.replace(/\s+/gu, " ").trim();
  if (!cleaned || /\p{Cc}/u.test(cleaned)) return null;
  return cleaned.slice(0, maxLength);
}

export function normalizeCurrency(value: unknown, fallback: Currency): Currency {
  if (typeof value !== "string") return fallback;
  const normalized = value.trim().toUpperCase();
  return normalized === "GBP" ? "GBP" : normalized === "EUR" ? "EUR" : fallback;
}

export function parseMoneyMinor(value: unknown): number | null {
  if (typeof value === "number") {
    if (!Number.isFinite(value) || value < 0) return null;
    const result = Math.round(value * 100);
    return Number.isSafeInteger(result) ? result : null;
  }
  if (typeof value !== "string") return null;

  let raw = value.normalize("NFKC").replace(/[^\d,.-]/gu, "").trim();
  if (!raw || raw.startsWith("-")) return null;

  const lastComma = raw.lastIndexOf(",");
  const lastDot = raw.lastIndexOf(".");
  const separator = Math.max(lastComma, lastDot);
  const decimalDigits = separator >= 0 ? raw.length - separator - 1 : 0;
  const hasDecimal = separator >= 0 && decimalDigits > 0 && decimalDigits <= 2;

  if (hasDecimal) {
    const integerPart = raw.slice(0, separator).replace(/[^\d]/gu, "") || "0";
    const fraction = raw.slice(separator + 1).replace(/\D/gu, "").padEnd(2, "0").slice(0, 2);
    raw = `${integerPart}.${fraction}`;
  } else {
    raw = raw.replace(/\D/gu, "");
  }

  const numeric = Number(raw);
  const result = Math.round(numeric * 100);
  return Number.isFinite(numeric) && Number.isSafeInteger(result) ? result : null;
}

export function normalizeProductUrl(rawUrl: string, allowedHosts: ReadonlySet<string>): string {
  const url = new URL(rawUrl);
  const host = url.hostname.toLowerCase().replace(/\.$/u, "");
  if (url.protocol !== "https:" || !allowedHosts.has(host) || url.username || url.password) {
    throw new Error("URL produit refusée: protocole ou hôte non autorisé.");
  }
  url.hostname = host;
  url.hash = "";
  for (const key of [...url.searchParams.keys()]) {
    if (key.toLowerCase().startsWith("utm_") || TRACKING_PARAMETERS.has(key.toLowerCase())) {
      url.searchParams.delete(key);
    }
  }
  return url.toString();
}

export function stableHash(parts: readonly unknown[]): string {
  return createHash("sha256").update(JSON.stringify(parts)).digest("hex");
}

export function productKey(input: {
  source: RetailSource;
  market: Market;
  externalId: string;
}): string {
  return `${input.source}:${input.market.toLowerCase()}:${stableHash([
    input.source,
    input.market,
    input.externalId.trim().toLowerCase(),
  ]).slice(0, 24)}`;
}
