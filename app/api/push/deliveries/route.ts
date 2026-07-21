import { and, eq } from "drizzle-orm";

import { getDb } from "../../../../db";
import {
  alerts,
  notificationDeliveries,
  pushSubscriptions,
  userPreferences,
} from "../../../../db/schema";
import { authorizePushDelivery, serverJson } from "../server-auth";
import { isQuietNow } from "../quiet-hours";

export const dynamic = "force-dynamic";

const MAX_BODY_BYTES = 16 * 1024;
const GONE_CODES = new Set(["PUSH_404", "PUSH_410"]);

type UnknownRecord = Record<string, unknown>;

function isRecord(value: unknown): value is UnknownRecord {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function requiredInteger(value: unknown, field: string) {
  if (!Number.isSafeInteger(value) || (value as number) < 1) {
    throw new Error(`${field} doit être un entier positif.`);
  }
  return value as number;
}

function requiredId(value: unknown, field: string, maximum = 160) {
  if (typeof value !== "string") throw new Error(`${field} est obligatoire.`);
  const cleaned = value.trim();
  if (cleaned.length < 1 || cleaned.length > maximum || !/^[A-Za-z0-9._:-]+$/.test(cleaned)) {
    throw new Error(`${field} est invalide.`);
  }
  return cleaned;
}

async function readBody(request: Request) {
  const declared = Number(request.headers.get("content-length") ?? "0");
  if (Number.isFinite(declared) && declared > MAX_BODY_BYTES) return null;
  const text = await request.text();
  if (new TextEncoder().encode(text).byteLength > MAX_BODY_BYTES) return null;
  try {
    const parsed = JSON.parse(text) as unknown;
    return isRecord(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

function evidenceEligible(value: string) {
  try {
    const parsed = JSON.parse(value) as unknown;
    return isRecord(parsed) && parsed.notificationEligible === true;
  } catch {
    return false;
  }
}

async function reserve(body: UnknownRecord) {
  const alertId = requiredId(body.alertId, "alertId");
  const subscriptionId = requiredInteger(body.subscriptionId, "subscriptionId");
  const tier = body.tier === undefined ? "personal" : body.tier;
  if (tier !== "urgent" && tier !== "personal" && tier !== "digest") {
    throw new Error("tier doit être urgent, personal ou digest.");
  }
  const database = getDb();
  const [[subscription], [alert]] = await Promise.all([
    database
      .select({
        ownerId: pushSubscriptions.ownerId,
        enabled: pushSubscriptions.enabled,
        quietHours: userPreferences.quietHours,
        quietStart: userPreferences.quietStart,
        quietEnd: userPreferences.quietEnd,
        timezone: userPreferences.timezone,
        notificationEnabled: userPreferences.notificationEnabled,
        minScore: userPreferences.minScore,
      })
      .from(pushSubscriptions)
      .innerJoin(
        userPreferences,
        eq(userPreferences.ownerId, pushSubscriptions.ownerId),
      )
      .where(eq(pushSubscriptions.id, subscriptionId))
      .limit(1),
    database
      .select({
        sourceMode: alerts.sourceMode,
        status: alerts.status,
        score: alerts.score,
        shippingCents: alerts.shippingCents,
        observedAt: alerts.observedAt,
        verifiedAt: alerts.verifiedAt,
        expiresAt: alerts.expiresAt,
        evidenceJson: alerts.evidenceJson,
      })
      .from(alerts)
      .where(eq(alerts.id, alertId))
      .limit(1),
  ]);

  if (!subscription?.enabled || !subscription.notificationEnabled) {
    return serverJson(
      { ok: false, code: "subscription_unavailable", error: "Souscription indisponible." },
      404,
    );
  }

  const now = Date.now();
  const freshAfter = now - 120 * 60_000;
  const alertEligible =
    alert?.sourceMode === "live" &&
    alert.status === "active" &&
    alert.score >= 65 &&
    alert.shippingCents !== null &&
    alert.verifiedAt !== null &&
    alert.expiresAt !== null &&
    Date.parse(alert.observedAt) >= freshAfter &&
    Date.parse(alert.verifiedAt) >= freshAfter &&
    Date.parse(alert.expiresAt) > now &&
    evidenceEligible(alert.evidenceJson);
  if (!alert || !alertEligible) {
    return serverJson(
      { ok: false, code: "alert_not_eligible", error: "Cette alerte n’est pas éligible à une notification." },
      409,
    );
  }

  const digestDay = tier === "digest" ? `:${new Date().toISOString().slice(0, 10)}` : "";
  const dedupeKey = `${alertId}:${subscriptionId}:web_push:${tier}${digestDay}`;
  if (alert.score < subscription.minScore) {
    const [suppressed] = await database
      .insert(notificationDeliveries)
      .values({
        alertId,
        subscriptionId,
        ownerId: subscription.ownerId,
        channel: "web_push",
        tier,
        status: "suppressed",
        dedupeKey,
        errorCode: "MINIMUM_SCORE",
      })
      .onConflictDoNothing({ target: notificationDeliveries.dedupeKey })
      .returning({ id: notificationDeliveries.id });
    return serverJson({
      ok: true,
      reserved: false,
      suppressed: true,
      reason: "minimum_score",
      reservationId: suppressed?.id ?? null,
    });
  }
  if (isQuietNow(subscription)) {
    const [suppressed] = await database
      .insert(notificationDeliveries)
      .values({
        alertId,
        subscriptionId,
        ownerId: subscription.ownerId,
        channel: "web_push",
        tier,
        status: "suppressed",
        dedupeKey,
        errorCode: "QUIET_HOURS",
      })
      .onConflictDoNothing({ target: notificationDeliveries.dedupeKey })
      .returning({ id: notificationDeliveries.id });
    return serverJson({
      ok: true,
      reserved: false,
      suppressed: true,
      reason: "quiet_hours",
      reservationId: suppressed?.id ?? null,
    });
  }

  const [created] = await database
    .insert(notificationDeliveries)
    .values({
      alertId,
      subscriptionId,
      ownerId: subscription.ownerId,
      channel: "web_push",
      tier,
      status: "reserved",
      dedupeKey,
    })
    .onConflictDoNothing({ target: notificationDeliveries.dedupeKey })
    .returning({ id: notificationDeliveries.id });

  if (created) {
    return serverJson({ ok: true, reserved: true, duplicate: false, reservationId: created.id }, 201);
  }

  const [existing] = await database
    .select({ id: notificationDeliveries.id, status: notificationDeliveries.status })
    .from(notificationDeliveries)
    .where(eq(notificationDeliveries.dedupeKey, dedupeKey))
    .limit(1);
  return serverJson({
    ok: true,
    reserved: false,
    duplicate: true,
    reservationId: existing?.id ?? null,
    status: existing?.status ?? "unknown",
  });
}

async function complete(body: UnknownRecord) {
  const reservationId = requiredInteger(body.reservationId, "reservationId");
  if (body.status !== "sent" && body.status !== "failed") {
    throw new Error("status doit être sent ou failed.");
  }
  const errorCode =
    body.errorCode === null || body.errorCode === undefined
      ? null
      : requiredId(body.errorCode, "errorCode", 80);
  if (body.status === "sent" && errorCode !== null) {
    throw new Error("errorCode doit être absent pour un envoi réussi.");
  }

  const database = getDb();
  const [reservation] = await database
    .select({ subscriptionId: notificationDeliveries.subscriptionId })
    .from(notificationDeliveries)
    .where(
      and(
        eq(notificationDeliveries.id, reservationId),
        eq(notificationDeliveries.status, "reserved"),
      ),
    )
    .limit(1);
  if (!reservation) {
    return serverJson(
      { ok: false, code: "reservation_unavailable", error: "Réservation déjà finalisée ou inconnue." },
      409,
    );
  }

  const now = new Date().toISOString();
  await database
    .update(notificationDeliveries)
    .set({
      status: body.status,
      sentAt: body.status === "sent" ? now : null,
      errorCode,
    })
    .where(
      and(
        eq(notificationDeliveries.id, reservationId),
        eq(notificationDeliveries.status, "reserved"),
      ),
    );

  if (errorCode !== null && GONE_CODES.has(errorCode)) {
    await database
      .update(pushSubscriptions)
      .set({ enabled: false, updatedAt: now })
      .where(eq(pushSubscriptions.id, reservation.subscriptionId));
  }

  return serverJson({ ok: true, completed: true, reservationId, status: body.status });
}

export async function POST(request: Request) {
  const authentication = await authorizePushDelivery(request);
  if (!authentication.ok) return authentication.response;

  let body: UnknownRecord | null;
  try {
    body = await readBody(request);
  } catch {
    body = null;
  }
  if (body === null) {
    return serverJson(
      { ok: false, code: "invalid_json", error: "Le corps JSON est invalide ou trop volumineux." },
      400,
    );
  }

  try {
    if (body.action === "reserve") return await reserve(body);
    if (body.action === "complete") return await complete(body);
    return serverJson(
      { ok: false, code: "invalid_action", error: "action doit être reserve ou complete." },
      400,
    );
  } catch (error) {
    const message = error instanceof Error ? error.message : "Requête invalide.";
    if (
      message.includes("no such table") ||
      message.includes("D1 binding") ||
      message.includes("env.DB")
    ) {
      return serverJson(
        { ok: false, code: "push_deliveries_not_ready", error: "L’audit push n’est pas initialisé." },
        503,
      );
    }
    if (error instanceof Error && /doit|obligatoire|invalide|absent/.test(error.message)) {
      return serverJson({ ok: false, code: "invalid_delivery", error: error.message }, 400);
    }
    console.error("[push-deliveries] D1 request failed");
    return serverJson(
      { ok: false, code: "push_delivery_failed", error: "Impossible de journaliser cet envoi." },
      500,
    );
  }
}
