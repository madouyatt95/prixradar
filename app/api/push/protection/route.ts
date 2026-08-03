import { and, eq } from "drizzle-orm";

import { getDb } from "@/db";
import { protectionNotifications, purchases, pushSubscriptions, userPreferences } from "@/db/schema";
import { authorizePushDelivery, serverJson } from "../server-auth";
import { isQuietNow } from "../quiet-hours";

export const dynamic = "force-dynamic";

const PURCHASE_ID = /^purchase:[0-9a-f-]{36}$/u;
const GONE_CODES = new Set(["PUSH_404", "PUSH_410"]);

function money(cents: number, currency: string) {
  return new Intl.NumberFormat("fr-FR", { style: "currency", currency, maximumFractionDigits: 2 }).format(cents / 100);
}

export async function GET(request: Request) {
  const authentication = await authorizePushDelivery(request);
  if (!authentication.ok) return authentication.response;
  const purchaseId = new URL(request.url).searchParams.get("purchaseId")?.trim() ?? "";
  if (!PURCHASE_ID.test(purchaseId)) return serverJson({ ok: false, code: "invalid_purchase" }, 400);
  try {
    const database = getDb();
    const [purchase] = await database.select().from(purchases).where(and(
      eq(purchases.id, purchaseId),
      eq(purchases.status, "action_available"),
    )).limit(1);
    if (!purchase || purchase.bestPriceCents === null || purchase.potentialRecoveryCents <= 0) {
      return serverJson({ ok: true, targets: [] });
    }
    const subscriptions = await database.select({
      id: pushSubscriptions.id,
      endpoint: pushSubscriptions.endpoint,
      p256dh: pushSubscriptions.p256dh,
      auth: pushSubscriptions.auth,
      contentEncoding: pushSubscriptions.contentEncoding,
      quietHours: userPreferences.quietHours,
      quietStart: userPreferences.quietStart,
      quietEnd: userPreferences.quietEnd,
      timezone: userPreferences.timezone,
      notificationEnabled: userPreferences.notificationEnabled,
    }).from(pushSubscriptions).innerJoin(userPreferences, eq(userPreferences.ownerId, pushSubscriptions.ownerId)).where(and(
      eq(pushSubscriptions.ownerId, purchase.ownerId),
      eq(pushSubscriptions.enabled, true),
      eq(userPreferences.notificationEnabled, true),
    )).limit(5);
    const targets = [];
    for (const subscription of subscriptions) {
      if (isQuietNow(subscription)) continue;
      const dedupeKey = `${purchase.id}:${subscription.id}:${purchase.bestPriceCents}:protection`;
      const attemptedAt = new Date().toISOString();
      const [created] = await database.insert(protectionNotifications).values({
        purchaseId: purchase.id,
        subscriptionId: subscription.id,
        ownerId: purchase.ownerId,
        priceCents: purchase.bestPriceCents,
        status: "reserved",
        dedupeKey,
        attemptedAt,
      }).onConflictDoNothing({ target: protectionNotifications.dedupeKey }).returning({ id: protectionNotifications.id });
      let notificationId = created?.id ?? null;
      if (notificationId === null) {
        const [existing] = await database.select({ id: protectionNotifications.id, status: protectionNotifications.status, attemptedAt: protectionNotifications.attemptedAt })
          .from(protectionNotifications).where(eq(protectionNotifications.dedupeKey, dedupeKey)).limit(1);
        const staleReservation = existing?.status === "reserved" && Date.parse(existing.attemptedAt) < Date.now() - 15 * 60_000;
        if (existing && (existing.status === "failed" || staleReservation)) {
          await database.update(protectionNotifications).set({ status: "reserved", attemptedAt, sentAt: null, errorCode: null }).where(eq(protectionNotifications.id, existing.id));
          notificationId = existing.id;
        }
      }
      if (notificationId === null) continue;
      targets.push({
        notificationId,
        id: subscription.id,
        endpoint: subscription.endpoint,
        keys: { p256dh: subscription.p256dh, auth: subscription.auth },
        contentEncoding: subscription.contentEncoding,
        purchaseId: purchase.id,
        title: "PrixRadar · baisse après votre achat",
        body: `${purchase.title} est à ${money(purchase.bestPriceCents, purchase.currency)} · ${money(purchase.potentialRecoveryCents, purchase.currency)} potentiellement récupérables`,
        url: `/?tab=missions&purchase=${encodeURIComponent(purchase.id)}`,
      });
    }
    return serverJson({ ok: true, targets });
  } catch (error) {
    const message = error instanceof Error ? error.message : "";
    if (message.includes("no such table") || message.includes("D1 binding") || message.includes("env.DB")) return serverJson({ ok: false, code: "protection_push_not_ready" }, 503);
    return serverJson({ ok: false, code: "protection_push_failed" }, 500);
  }
}

export async function POST(request: Request) {
  const authentication = await authorizePushDelivery(request);
  if (!authentication.ok) return authentication.response;
  let body: Record<string, unknown> | null = null;
  try {
    const candidate: unknown = await request.json();
    body = candidate && typeof candidate === "object" && !Array.isArray(candidate) ? candidate as Record<string, unknown> : null;
  } catch { body = null; }
  const notificationId = Number(body?.notificationId);
  const status = body?.status;
  const errorCode = typeof body?.errorCode === "string" && /^[A-Z0-9_]{3,80}$/u.test(body.errorCode) ? body.errorCode : null;
  if (!Number.isSafeInteger(notificationId) || notificationId < 1 || status !== "sent" && status !== "failed" || status === "sent" && errorCode !== null) {
    return serverJson({ ok: false, code: "invalid_protection_delivery" }, 400);
  }
  try {
    const database = getDb();
    const [notification] = await database.select({ subscriptionId: protectionNotifications.subscriptionId }).from(protectionNotifications).where(and(
      eq(protectionNotifications.id, notificationId),
      eq(protectionNotifications.status, "reserved"),
    )).limit(1);
    if (!notification) return serverJson({ ok: false, code: "protection_delivery_unavailable" }, 409);
    const now = new Date().toISOString();
    await database.update(protectionNotifications).set({ status, sentAt: status === "sent" ? now : null, errorCode }).where(eq(protectionNotifications.id, notificationId));
    if (errorCode && GONE_CODES.has(errorCode)) await database.update(pushSubscriptions).set({ enabled: false, updatedAt: now }).where(eq(pushSubscriptions.id, notification.subscriptionId));
    return serverJson({ ok: true, notificationId, status });
  } catch {
    return serverJson({ ok: false, code: "protection_delivery_failed" }, 500);
  }
}
