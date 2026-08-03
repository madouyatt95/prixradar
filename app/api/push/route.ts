import { and, desc, eq, sql } from "drizzle-orm";

import { getDb } from "../../../db";
import { pushSubscriptions, userPreferences } from "../../../db/schema";
import {
  deviceDatabaseError,
  deviceError,
  deviceJson,
  readJsonObject,
  resolveDevice,
} from "./device";
import { vapidPublicKey } from "./server-env";

export const dynamic = "force-dynamic";

const BASE64URL_PATTERN = /^[A-Za-z0-9_-]+$/;
const CONTENT_ENCODINGS = new Set(["aes128gcm", "aesgcm"]);

type SubscriptionInput = {
  endpoint: string;
  p256dh: string;
  auth: string;
  contentEncoding: string;
};

function requiredString(
  value: unknown,
  name: string,
  minLength: number,
  maxLength: number
) {
  if (typeof value !== "string") {
    throw new Error(`${name} est obligatoire.`);
  }
  const cleaned = value.trim();
  if (cleaned.length < minLength || cleaned.length > maxLength) {
    throw new Error(`${name} a une longueur invalide.`);
  }
  return cleaned;
}

function parseSubscription(body: Record<string, unknown>): SubscriptionInput {
  const endpoint = requiredString(body.endpoint, "endpoint", 12, 2_048);
  let endpointUrl: URL;
  try {
    endpointUrl = new URL(endpoint);
  } catch {
    throw new Error("endpoint doit être une adresse HTTPS valide.");
  }
  if (endpointUrl.protocol !== "https:") {
    throw new Error("endpoint doit utiliser HTTPS.");
  }

  const keys = body.keys;
  if (!keys || typeof keys !== "object" || Array.isArray(keys)) {
    throw new Error("Les clés p256dh et auth sont obligatoires.");
  }
  const keyRecord = keys as Record<string, unknown>;
  const p256dh = requiredString(keyRecord.p256dh, "p256dh", 40, 512);
  const auth = requiredString(keyRecord.auth, "auth", 16, 256);
  if (!BASE64URL_PATTERN.test(p256dh) || !BASE64URL_PATTERN.test(auth)) {
    throw new Error("Les clés de souscription doivent être encodées en base64url.");
  }

  const rawEncoding = body.contentEncoding ?? "aes128gcm";
  const contentEncoding = requiredString(
    rawEncoding,
    "contentEncoding",
    6,
    16
  ).toLowerCase();
  if (!CONTENT_ENCODINGS.has(contentEncoding)) {
    throw new Error("contentEncoding doit être aes128gcm ou aesgcm.");
  }

  return {
    endpoint: endpointUrl.toString(),
    p256dh,
    auth,
    contentEncoding,
  };
}

export async function GET(request: Request) {
  const identity = await resolveDevice(request);
  if (!identity.ok) return identity.response;
  const device = identity.device;

  try {
    const db = getDb();
    const subscriptions = await db
      .select({
        id: pushSubscriptions.id,
        enabled: pushSubscriptions.enabled,
        updatedAt: pushSubscriptions.updatedAt,
      })
      .from(pushSubscriptions)
      .where(eq(pushSubscriptions.ownerId, device.ownerId))
      .orderBy(desc(pushSubscriptions.updatedAt));

    const [preference] = await db
      .select({ notificationEnabled: userPreferences.notificationEnabled })
      .from(userPreferences)
      .where(eq(userPreferences.ownerId, device.ownerId))
      .limit(1);

    const publicKey = vapidPublicKey();
    const activeSubscriptions = subscriptions.filter((item) => item.enabled);

    return deviceJson(device, {
      ok: true,
      configured: publicKey !== null,
      publicKey,
      notificationEnabled: preference?.notificationEnabled ?? true,
      subscribed: activeSubscriptions.length > 0,
      activeSubscriptionCount: activeSubscriptions.length,
      lastUpdatedAt: subscriptions[0]?.updatedAt ?? null,
    });
  } catch (error) {
    return deviceDatabaseError(device, error);
  }
}

export async function POST(request: Request) {
  const identity = await resolveDevice(request);
  if (!identity.ok) return identity.response;
  const device = identity.device;
  if (vapidPublicKey() === null) {
    return deviceError(
      device,
      503,
      "push_not_configured",
      "Les notifications push ne sont pas encore configurées sur le serveur."
    );
  }

  const body = await readJsonObject(request);
  if (body === null) {
    return deviceError(device, 400, "invalid_json", "Le corps JSON est invalide.");
  }

  let subscription: SubscriptionInput;
  try {
    subscription = parseSubscription(body);
  } catch (error) {
    return deviceError(
      device,
      400,
      "invalid_subscription",
      error instanceof Error ? error.message : "La souscription est invalide."
    );
  }

  try {
    const db = getDb();
    await db
      .insert(userPreferences)
      .values({ ownerId: device.ownerId })
      .onConflictDoNothing({ target: userPreferences.ownerId });

    const currentSubscriptions = await db
      .select({ endpoint: pushSubscriptions.endpoint, enabled: pushSubscriptions.enabled })
      .from(pushSubscriptions)
      .where(eq(pushSubscriptions.ownerId, device.ownerId))
      .limit(6);
    const existingEndpoint = currentSubscriptions.some(
      (item) => item.endpoint === subscription.endpoint,
    );
    const activeCount = currentSubscriptions.filter((item) => item.enabled).length;
    if (!existingEndpoint && activeCount >= 5) {
      return deviceError(
        device,
        409,
        "subscription_limit_reached",
        "Cet appareil a atteint la limite de cinq souscriptions actives.",
      );
    }

    const [saved] = await db
      .insert(pushSubscriptions)
      .values({ ownerId: device.ownerId, ...subscription })
      .onConflictDoUpdate({
        target: [pushSubscriptions.ownerId, pushSubscriptions.endpoint],
        set: {
          p256dh: subscription.p256dh,
          auth: subscription.auth,
          contentEncoding: subscription.contentEncoding,
          enabled: true,
          updatedAt: sql`CURRENT_TIMESTAMP`,
        },
      })
      .returning({
        id: pushSubscriptions.id,
        enabled: pushSubscriptions.enabled,
        updatedAt: pushSubscriptions.updatedAt,
      });

    return deviceJson(
      device,
      { ok: true, subscribed: true, subscription: saved },
      { status: 201 }
    );
  } catch (error) {
    return deviceDatabaseError(device, error);
  }
}

export async function DELETE(request: Request) {
  const identity = await resolveDevice(request);
  if (!identity.ok) return identity.response;
  const device = identity.device;
  let endpoint: string | null = null;

  if (request.headers.get("content-type")?.includes("application/json")) {
    const body = await readJsonObject(request);
    if (body === null) {
      return deviceError(
        device,
        400,
        "invalid_json",
        "Le corps JSON est invalide."
      );
    }

    if (body.endpoint !== undefined) {
      try {
        endpoint = requiredString(body.endpoint, "endpoint", 12, 2_048);
        const parsed = new URL(endpoint);
        if (parsed.protocol !== "https:") throw new Error();
        endpoint = parsed.toString();
      } catch {
        return deviceError(
          device,
          400,
          "invalid_endpoint",
          "endpoint doit être une adresse HTTPS valide."
        );
      }
    }
  }

  try {
    const conditions = [eq(pushSubscriptions.ownerId, device.ownerId)];
    if (endpoint !== null) {
      conditions.push(eq(pushSubscriptions.endpoint, endpoint));
    }

    const disabled = await getDb()
      .update(pushSubscriptions)
      .set({ enabled: false, updatedAt: sql`CURRENT_TIMESTAMP` })
      .where(and(...conditions))
      .returning({ id: pushSubscriptions.id });

    return deviceJson(device, {
      ok: true,
      subscribed: false,
      disabled: disabled.length,
    });
  } catch (error) {
    return deviceDatabaseError(device, error);
  }
}
