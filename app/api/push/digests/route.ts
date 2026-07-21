import { and, desc, eq, gt, gte, inArray } from "drizzle-orm";

import { getDb } from "@/db";
import { alerts, pushSubscriptions, radarRules, userPreferences } from "@/db/schema";
import { radarIntentMatches, type RadarIntent } from "@/lib/radar-intent";
import { authorizePushDelivery, serverJson } from "../server-auth";
import { isQuietNow } from "../quiet-hours";

export const dynamic = "force-dynamic";

function list(value: string) {
  try {
    const parsed: unknown = JSON.parse(value);
    return Array.isArray(parsed) ? parsed.filter((item): item is string => typeof item === "string") : [];
  } catch { return []; }
}

function intent(value: string): RadarIntent | null {
  try { return JSON.parse(value) as RadarIntent; } catch { return null; }
}

export async function GET(request: Request) {
  const authentication = await authorizePushDelivery(request);
  if (!authentication.ok) return authentication.response;
  try {
    const database = getDb();
    const now = new Date();
    const nowIso = now.toISOString();
    const since = new Date(now.getTime() - 24 * 60 * 60_000).toISOString();
    const [subscriptions, candidates] = await Promise.all([
      database.select({
        id: pushSubscriptions.id,
        ownerId: pushSubscriptions.ownerId,
        endpoint: pushSubscriptions.endpoint,
        p256dh: pushSubscriptions.p256dh,
        auth: pushSubscriptions.auth,
        contentEncoding: pushSubscriptions.contentEncoding,
        minScore: userPreferences.minScore,
        quietHours: userPreferences.quietHours,
        quietStart: userPreferences.quietStart,
        quietEnd: userPreferences.quietEnd,
        timezone: userPreferences.timezone,
        minDiscount: userPreferences.minDiscount,
        maxPriceCents: userPreferences.maxPriceCents,
        marketsJson: userPreferences.marketsJson,
        categoriesJson: userPreferences.categoriesJson,
        sourcesJson: userPreferences.sourcesJson,
      }).from(pushSubscriptions).innerJoin(userPreferences, eq(userPreferences.ownerId, pushSubscriptions.ownerId))
        .where(and(
          eq(pushSubscriptions.enabled, true),
          eq(userPreferences.notificationEnabled, true),
          eq(userPreferences.notificationSpeed, "digest"),
        )).limit(500),
      database.select().from(alerts).where(and(
        eq(alerts.sourceMode, "live"), eq(alerts.status, "active"), eq(alerts.priceAccessibleToAll, true),
        gte(alerts.updatedAt, since), gt(alerts.expiresAt, nowIso),
      )).orderBy(desc(alerts.buyNowScore), desc(alerts.score)).limit(60),
    ]);
    const owners = [...new Set(subscriptions.map((row) => row.ownerId))];
    const rules = owners.length === 0 ? [] : await database.select({ ownerId: radarRules.ownerId, intentJson: radarRules.intentJson })
      .from(radarRules).where(and(inArray(radarRules.ownerId, owners), eq(radarRules.enabled, true)));
    const rulesByOwner = new Map<string, RadarIntent[]>();
    for (const rule of rules) {
      const parsed = intent(rule.intentJson);
      if (parsed) rulesByOwner.set(rule.ownerId, [...(rulesByOwner.get(rule.ownerId) ?? []), parsed]);
    }
    const targets = subscriptions.flatMap((subscription) => {
      if (isQuietNow(subscription, now)) return [];
      const markets = list(subscription.marketsJson);
      const categories = list(subscription.categoriesJson);
      const sources = list(subscription.sourcesJson);
      const ownerRules = rulesByOwner.get(subscription.ownerId) ?? [];
      const matches = candidates.filter((alert) => {
        const priceCents = alert.publicPriceCents ?? alert.priceCents;
        const globalMatch = alert.score >= subscription.minScore
          && alert.discountPercent >= subscription.minDiscount
          && (subscription.maxPriceCents === null || priceCents <= subscription.maxPriceCents)
          && (markets.length === 0 || markets.includes(alert.market))
          && (categories.length === 0 || categories.includes(alert.category ?? ""))
          && (sources.length === 0 || sources.includes(alert.source));
        const radarMatch = ownerRules.length === 0 || ownerRules.some((rule) => radarIntentMatches(rule, {
          title: alert.title, brand: alert.brand, category: alert.category, market: alert.market,
          priceCents, discountPercent: alert.discountPercent, condition: alert.condition,
          accessibleToAll: alert.priceAccessibleToAll, deliveryCountry: alert.deliveryCountry,
        }));
        return globalMatch && radarMatch;
      }).slice(0, 5);
      if (matches.length === 0) return [];
      const lead = matches[0];
      const amount = ((lead.publicPriceCents ?? lead.priceCents) / 100).toLocaleString("fr-FR", { maximumFractionDigits: 2 });
      return [{
        id: subscription.id,
        endpoint: subscription.endpoint,
        keys: { p256dh: subscription.p256dh, auth: subscription.auth },
        contentEncoding: subscription.contentEncoding,
        alertId: lead.id,
        title: `PrixRadar · ${matches.length} opportunité${matches.length > 1 ? "s" : ""} aujourd’hui`,
        body: `${lead.title} à ${amount} ${lead.currency}${matches.length > 1 ? ` · et ${matches.length - 1} autre${matches.length > 2 ? "s" : ""}` : ""}`,
        url: `/?alert=${encodeURIComponent(lead.id)}`,
      }];
    });
    return serverJson({ ok: true, generatedAt: nowIso, count: targets.length, targets });
  } catch {
    return serverJson({ ok: false, code: "digests_failed", error: "Impossible de préparer les résumés." }, 503);
  }
}
