import { and, eq } from "drizzle-orm";

import { getDb } from "@/db";
import {
  pushSubscriptions,
  socialNotificationDeliveries,
  socialPublications,
  socialSources,
  userPreferences,
} from "@/db/schema";
import { authorizePushDelivery, serverJson } from "../server-auth";
import { isQuietNow } from "../quiet-hours";

export const dynamic = "force-dynamic";

const GONE_CODES = new Set(["PUSH_404", "PUSH_410"]);

type UnknownRecord = Record<string, unknown>;

function validPublicationId(value: string | null) {
  return value && /^(?:facebook:\d{6,20}|x:[a-z0-9_]{1,30}):[A-Za-z0-9._:-]{3,160}$/u.test(value)
    ? value
    : null;
}

function isRecord(value: unknown): value is UnknownRecord {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

async function body(request: Request) {
  const text = await request.text();
  if (new TextEncoder().encode(text).byteLength > 16 * 1024) return null;
  try {
    const parsed = JSON.parse(text) as unknown;
    return isRecord(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

export async function GET(request: Request) {
  const authentication = await authorizePushDelivery(request);
  if (!authentication.ok) return authentication.response;
  const publicationId = validPublicationId(new URL(request.url).searchParams.get("publicationId"));
  if (!publicationId) return serverJson({ ok: false, code: "invalid_publication" }, 400);

  try {
    const database = getDb();
    const [publication] = await database.select({
      id: socialPublications.id,
      sourceId: socialPublications.sourceId,
      sourceName: socialSources.name,
      platform: socialSources.platform,
      author: socialPublications.author,
      text: socialPublications.text,
      publicationUrl: socialPublications.publicationUrl,
      imageUrl: socialPublications.imageUrl,
    }).from(socialPublications)
      .innerJoin(socialSources, eq(socialSources.id, socialPublications.sourceId))
      .where(eq(socialPublications.id, publicationId))
      .limit(1);
    if (!publication) return serverJson({ ok: false, code: "publication_unavailable" }, 404);

    const subscriptions = await database.select({
      id: pushSubscriptions.id,
      ownerId: pushSubscriptions.ownerId,
      endpoint: pushSubscriptions.endpoint,
      p256dh: pushSubscriptions.p256dh,
      auth: pushSubscriptions.auth,
      contentEncoding: pushSubscriptions.contentEncoding,
      quietHours: userPreferences.quietHours,
      quietStart: userPreferences.quietStart,
      quietEnd: userPreferences.quietEnd,
      timezone: userPreferences.timezone,
    }).from(pushSubscriptions)
      .innerJoin(userPreferences, eq(userPreferences.ownerId, pushSubscriptions.ownerId))
      .where(and(
        eq(pushSubscriptions.enabled, true),
        eq(userPreferences.notificationEnabled, true),
        eq(userPreferences.socialNotificationsEnabled, true),
      ));

    const targets = [];
    for (const subscription of subscriptions) {
      const dedupeKey = `${publication.id}:${subscription.id}:web_push`;
      const quiet = isQuietNow(subscription);
      const [reservation] = await database.insert(socialNotificationDeliveries).values({
        publicationId: publication.id,
        subscriptionId: subscription.id,
        ownerId: subscription.ownerId,
        status: quiet ? "suppressed" : "reserved",
        dedupeKey,
        errorCode: quiet ? "QUIET_HOURS" : null,
      }).onConflictDoNothing({ target: socialNotificationDeliveries.dedupeKey })
        .returning({ id: socialNotificationDeliveries.id });
      if (!reservation || quiet) continue;
      targets.push({
        id: subscription.id,
        endpoint: subscription.endpoint,
        keys: { p256dh: subscription.p256dh, auth: subscription.auth },
        contentEncoding: subscription.contentEncoding,
        notificationId: reservation.id,
        publicationId: publication.id,
        title: `${publication.platform === "facebook" ? "Facebook" : "X"} · ${publication.sourceName}`,
        body: publication.text.replace(/\s+/gu, " ").slice(0, 180),
        url: publication.publicationUrl,
        imageUrl: publication.imageUrl,
      });
    }
    return serverJson({ ok: true, targets });
  } catch (error) {
    const message = error instanceof Error ? error.message : "";
    return serverJson({
      ok: false,
      code: message.includes("no such table") ? "social_push_not_ready" : "social_push_failed",
    }, message.includes("no such table") ? 503 : 500);
  }
}

export async function POST(request: Request) {
  const authentication = await authorizePushDelivery(request);
  if (!authentication.ok) return authentication.response;
  const value = await body(request);
  if (!value || !Number.isSafeInteger(value.notificationId) || Number(value.notificationId) < 1 || (value.status !== "sent" && value.status !== "failed")) {
    return serverJson({ ok: false, code: "invalid_completion" }, 400);
  }
  const errorCode = typeof value.errorCode === "string" && /^[A-Z0-9_]{3,80}$/u.test(value.errorCode) ? value.errorCode : null;
  if (value.status === "sent" && errorCode !== null) return serverJson({ ok: false, code: "invalid_completion" }, 400);

  try {
    const database = getDb();
    const notificationId = Number(value.notificationId);
    const [delivery] = await database.select({ subscriptionId: socialNotificationDeliveries.subscriptionId })
      .from(socialNotificationDeliveries)
      .where(and(
        eq(socialNotificationDeliveries.id, notificationId),
        eq(socialNotificationDeliveries.status, "reserved"),
      )).limit(1);
    if (!delivery) return serverJson({ ok: false, code: "notification_unavailable" }, 409);
    const now = new Date().toISOString();
    await database.update(socialNotificationDeliveries).set({
      status: value.status,
      sentAt: value.status === "sent" ? now : null,
      errorCode,
    }).where(eq(socialNotificationDeliveries.id, notificationId));
    if (errorCode && GONE_CODES.has(errorCode)) {
      await database.update(pushSubscriptions).set({ enabled: false, updatedAt: now })
        .where(eq(pushSubscriptions.id, delivery.subscriptionId));
    }
    return serverJson({ ok: true, completed: true });
  } catch {
    return serverJson({ ok: false, code: "social_push_failed" }, 500);
  }
}
