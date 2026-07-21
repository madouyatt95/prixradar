import { and, asc, eq, gt, inArray, lte } from "drizzle-orm";

import { getDb } from "../../../../db";
import {
  pushSubscriptions,
  radarRules,
  userPreferences,
} from "../../../../db/schema";
import { radarIntentMatches, type RadarIntent } from "../../../../lib/radar-intent";
import { authorizePushDelivery, serverJson } from "../server-auth";
import { isQuietNow } from "../quiet-hours";

export const dynamic = "force-dynamic";

function positiveInteger(value: string | null, fallback: number, maximum: number) {
  if (value === null) return fallback;
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) && parsed >= 0 && parsed <= maximum
    ? parsed
    : null;
}

export async function GET(request: Request) {
  const authentication = await authorizePushDelivery(request);
  if (!authentication.ok) return authentication.response;

  const search = new URL(request.url).searchParams;
  const limit = positiveInteger(search.get("limit"), 100, 500);
  const after = positiveInteger(search.get("after"), 0, Number.MAX_SAFE_INTEGER);
  const score = positiveInteger(search.get("score"), 100, 100);
  const discount = positiveInteger(search.get("discount"), 0, 100);
  const priceCents = positiveInteger(search.get("priceCents"), 0, 100_000_000);
  const source = search.get("source")?.trim().toLowerCase() ?? "";
  const market = search.get("market")?.trim().toUpperCase() ?? "";
  const category = search.get("category")?.trim() ?? "";
  const deliveryCountry = search.get("deliveryCountry")?.trim().toUpperCase() ?? "";
  const deliveryPostalPrefix = search.get("deliveryPostalPrefix")?.trim().toUpperCase() ?? "";
  const deliveryMode = search.get("deliveryMode")?.trim().toLowerCase() ?? "";
  const locationVerified = search.get("locationVerified") === "true";
  const title = search.get("title")?.trim().slice(0, 300) ?? "";
  const brand = search.get("brand")?.trim().slice(0, 100) ?? "";
  const condition = search.get("condition")?.trim().toLowerCase().slice(0, 30) ?? "";
  const accessibleToAll = search.get("accessibleToAll") !== "false";
  const sellerScore = positiveInteger(search.get("sellerScore"), 0, 100);
  const historyPoints = positiveInteger(search.get("historyPoints"), 0, 10_000);
  const verifiedAgeMinutes = positiveInteger(search.get("verifiedAgeMinutes"), 1_440, 1_440);
  const exactVariantConfirmed = search.get("exactVariantConfirmed") === "true";
  const cartConfirmed = search.get("cartConfirmed") === "true";
  const tier = search.get("tier") === "urgent" ? "urgent" as const : "personal" as const;
  if (limit === null || limit === 0 || after === null || score === null || discount === null || priceCents === null || sellerScore === null || historyPoints === null || verifiedAgeMinutes === null) {
    return serverJson(
      {
        ok: false,
        code: "invalid_pagination",
        error: "limit, after ou score est invalide.",
      },
      400
    );
  }

  try {
    const database = getDb();
    const page: Array<{
      id: number;
      endpoint: string;
      p256dh: string;
      auth: string;
      contentEncoding: string;
      minScore: number;
      tier: "urgent" | "personal";
    }> = [];
    const now = new Date();
    let cursor = after;
    let scanned = 0;
    let suppressedQuietHours = 0;
    let suppressedFilters = 0;
    let exhausted = false;

    while (page.length < limit && !exhausted && scanned < 2_500) {
      const batchSize = Math.min(500, Math.max(50, (limit - page.length) * 3));
      const rows = await database
        .select({
          id: pushSubscriptions.id,
          endpoint: pushSubscriptions.endpoint,
          p256dh: pushSubscriptions.p256dh,
          auth: pushSubscriptions.auth,
          contentEncoding: pushSubscriptions.contentEncoding,
          minScore: userPreferences.minScore,
          minSellerScore: userPreferences.minSellerScore,
          requireExactVariant: userPreferences.requireExactVariant,
          requireCartConfirmation: userPreferences.requireCartConfirmation,
          maxAlertAgeMinutes: userPreferences.maxAlertAgeMinutes,
          minimumHistoryPoints: userPreferences.minimumHistoryPoints,
          deviceOwner: pushSubscriptions.ownerId,
          notificationSpeed: userPreferences.notificationSpeed,
          quietHours: userPreferences.quietHours,
          quietStart: userPreferences.quietStart,
          quietEnd: userPreferences.quietEnd,
          timezone: userPreferences.timezone,
          minDiscount: userPreferences.minDiscount,
          maxPriceCents: userPreferences.maxPriceCents,
          marketsJson: userPreferences.marketsJson,
          categoriesJson: userPreferences.categoriesJson,
          sourcesJson: userPreferences.sourcesJson,
          deliveryCountry: userPreferences.deliveryCountry,
          postalCode: userPreferences.postalCode,
          deliveryMode: userPreferences.deliveryMode,
          requireLocationMatch: userPreferences.requireLocationMatch,
        })
        .from(pushSubscriptions)
        .innerJoin(
          userPreferences,
          eq(userPreferences.ownerId, pushSubscriptions.ownerId),
        )
        .where(
          and(
            eq(pushSubscriptions.enabled, true),
            eq(userPreferences.notificationEnabled, true),
            gt(pushSubscriptions.id, cursor),
            lte(userPreferences.minScore, score),
          ),
        )
        .orderBy(asc(pushSubscriptions.id))
        .limit(batchSize);

      if (rows.length === 0) {
        exhausted = true;
        break;
      }
      const ownerIds = [...new Set(rows.map((row) => row.deviceOwner))];
      const ruleRows = ownerIds.length === 0 ? [] : await database.select({
        deviceOwner: radarRules.ownerId,
        intentJson: radarRules.intentJson,
      }).from(radarRules).where(and(
        inArray(radarRules.ownerId, ownerIds),
        eq(radarRules.enabled, true),
      ));
      const rulesByOwner = new Map<string, RadarIntent[]>();
      for (const rule of ruleRows) {
        try {
          const parsed = JSON.parse(rule.intentJson) as RadarIntent;
          const current = rulesByOwner.get(rule.deviceOwner) ?? [];
          current.push(parsed);
          rulesByOwner.set(rule.deviceOwner, current);
        } catch { /* ignore une règle corrompue */ }
      }
      for (const row of rows) {
        cursor = row.id;
        scanned += 1;
        const parseList = (value: string) => {
          try {
            const parsed: unknown = JSON.parse(value);
            return Array.isArray(parsed) ? parsed.filter((item): item is string => typeof item === "string") : [];
          } catch {
            return [];
          }
        };
        const markets = parseList(row.marketsJson);
        const categories = parseList(row.categoriesJson);
        const sources = parseList(row.sourcesJson);
        const userPostalPrefix = row.postalCode
          ? row.deliveryCountry === "GB"
            ? row.postalCode.replace(/\s.+$/u, "").slice(0, 4)
            : row.postalCode.slice(0, 2)
          : "";
        const compatibleDeliveryMode = row.deliveryMode === "either" || deliveryMode === "either" || row.deliveryMode === deliveryMode;
        const locationMismatch = row.requireLocationMatch && (
          !locationVerified ||
          row.deliveryCountry !== deliveryCountry ||
          !compatibleDeliveryMode ||
          (userPostalPrefix !== "" && userPostalPrefix !== deliveryPostalPrefix)
        );
        const ownerRules = rulesByOwner.get(row.deviceOwner) ?? [];
        const radarMismatch = ownerRules.length > 0 && !ownerRules.some((intent) => radarIntentMatches(intent, {
          title,
          brand,
          category,
          market,
          priceCents,
          discountPercent: discount,
          condition,
          accessibleToAll,
          deliveryCountry,
        }));
        const speedMismatch = tier === "personal" && (
          row.notificationSpeed === "digest" ||
          (row.notificationSpeed === "balanced" && score < Math.min(100, row.minScore + 8))
        );
        const filtered =
          discount < row.minDiscount ||
          sellerScore < row.minSellerScore ||
          historyPoints < row.minimumHistoryPoints ||
          verifiedAgeMinutes > row.maxAlertAgeMinutes ||
          (row.requireExactVariant && !exactVariantConfirmed) ||
          (row.requireCartConfirmation && !cartConfirmed) ||
          (row.maxPriceCents !== null && priceCents > row.maxPriceCents) ||
          (markets.length > 0 && !markets.includes(market)) ||
          (categories.length > 0 && !categories.includes(category)) ||
          (sources.length > 0 && !sources.includes(source)) ||
          locationMismatch || radarMismatch || speedMismatch;
        if (isQuietNow(row, now)) {
          suppressedQuietHours += 1;
        } else if (filtered) {
          suppressedFilters += 1;
        } else {
          page.push({
            id: row.id,
            endpoint: row.endpoint,
            p256dh: row.p256dh,
            auth: row.auth,
            contentEncoding: row.contentEncoding,
            minScore: row.minScore,
            tier,
          });
        }
        if (page.length === limit || scanned >= 2_500) break;
      }
      if (rows.length < batchSize) exhausted = true;
    }

    return serverJson({
      ok: true,
      count: page.length,
      score,
      scanned,
      suppressedQuietHours,
      suppressedFilters,
      targets: page.map((row) => ({
        id: row.id,
        endpoint: row.endpoint,
        keys: { p256dh: row.p256dh, auth: row.auth },
        contentEncoding: row.contentEncoding,
        minScore: row.minScore,
        tier: row.tier,
      })),
      nextAfter: page.length === limit || !exhausted ? cursor : null,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    const unavailable =
      message.includes("no such table") ||
      message.includes("D1 binding") ||
      message.includes("env.DB");
    if (!unavailable) console.error("[push-targets] D1 request failed");

    return serverJson(
      {
        ok: false,
        code: unavailable ? "push_targets_not_ready" : "push_targets_failed",
        error: "Impossible de charger les destinataires push.",
      },
      unavailable ? 503 : 500
    );
  }
}
