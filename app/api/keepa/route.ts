import { runtimeEnv as env } from "@/lib/runtime-env";
import { eq, lt, sql } from "drizzle-orm";

import { getDb } from "@/db";
import { keepaCache, keepaUsage } from "@/db/schema";
import { resolveDevice } from "@/app/api/push/device";

import {
  KEEPA_MARKETS,
  classifyKeepaPayloadError,
  normalizeAsin,
  normalizeKeepaMarket,
  normalizeKeepaResponse,
  type KeepaUpstreamErrorKind,
} from "@/lib/keepa";

export const dynamic = "force-dynamic";

const KEEPA_PRODUCT_ENDPOINT = "https://api.keepa.com/product";
const KEEPA_TIMEOUT_MS = 12_000;
const KEEPA_CACHE_TTL_MS = 15 * 60_000;
const KEEPA_DEVICE_HOURLY_LIMIT = 20;

type ApiErrorCode =
  | "INVALID_ASIN"
  | "UNSUPPORTED_MARKET"
  | "KEEPA_NOT_CONFIGURED"
  | "KEEPA_TIMEOUT"
  | "KEEPA_RATE_LIMITED"
  | "KEEPA_GUARD_UNAVAILABLE"
  | "KEEPA_AUTH_ERROR"
  | "KEEPA_PRODUCT_NOT_FOUND"
  | "KEEPA_UPSTREAM_ERROR";

function json(body: unknown, status = 200, extraHeaders?: HeadersInit) {
  const headers = new Headers(extraHeaders);
  headers.set("Cache-Control", "no-store");
  return Response.json(body, {
    status,
    headers,
  });
}

function errorResponse(
  status: number,
  code: ApiErrorCode,
  message: string,
  mode: "off" | "keepa",
  headers?: HeadersInit,
) {
  return json(
    {
      ok: false,
      mode,
      code,
      message,
    },
    status,
    headers,
  );
}

async function cachedResponse(cacheId: string, nowIso: string) {
  const [cached] = await getDb()
    .select({ responseJson: keepaCache.responseJson, expiresAt: keepaCache.expiresAt })
    .from(keepaCache)
    .where(eq(keepaCache.id, cacheId))
    .limit(1);
  if (!cached || cached.expiresAt <= nowIso) return null;
  try {
    const parsed = JSON.parse(cached.responseJson) as unknown;
    if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) return null;
    return {
      ...(parsed as Record<string, unknown>),
      cache: { hit: true, expiresAt: cached.expiresAt },
    };
  } catch {
    return null;
  }
}

async function consumeQuota(ownerId: string, now: Date) {
  const windowStart = new Date(now);
  windowStart.setUTCMinutes(0, 0, 0);
  const windowIso = windowStart.toISOString();
  const id = `${ownerId}:${windowIso}`;
  const database = getDb();
  const [current] = await database
    .select({ requests: keepaUsage.requests })
    .from(keepaUsage)
    .where(eq(keepaUsage.id, id))
    .limit(1);
  if ((current?.requests ?? 0) >= KEEPA_DEVICE_HOURLY_LIMIT) {
    const retryAfter = Math.max(1, Math.ceil((windowStart.getTime() + 3_600_000 - now.getTime()) / 1_000));
    return { allowed: false as const, retryAfter };
  }

  await database
    .insert(keepaUsage)
    .values({ id, ownerId, windowStart: windowIso, requests: 1 })
    .onConflictDoUpdate({
      target: keepaUsage.id,
      set: {
        requests: sql`${keepaUsage.requests} + 1`,
        updatedAt: now.toISOString(),
      },
    });
  return { allowed: true as const };
}

function serverKeepaApiKey(): string | null {
  const workerKey = (env as unknown as { KEEPA_API_KEY?: unknown }).KEEPA_API_KEY;
  if (typeof workerKey === "string" && workerKey.trim().length > 0) return workerKey.trim();

  const nodeKey = process.env.KEEPA_API_KEY;
  return typeof nodeKey === "string" && nodeKey.trim().length > 0 ? nodeKey.trim() : null;
}

function upstreamErrorResponse(kind: KeepaUpstreamErrorKind) {
  if (kind === "rate_limited") {
    return errorResponse(
      429,
      "KEEPA_RATE_LIMITED",
      "Le quota Keepa est temporairement épuisé. Réessayez après son rechargement.",
      "keepa",
    );
  }

  if (kind === "authentication") {
    return errorResponse(
      502,
      "KEEPA_AUTH_ERROR",
      "La source Keepa refuse la configuration serveur actuelle.",
      "keepa",
    );
  }

  if (kind === "not_found") {
    return errorResponse(
      404,
      "KEEPA_PRODUCT_NOT_FOUND",
      "Keepa ne connaît pas encore cet ASIN sur ce marché.",
      "keepa",
    );
  }

  return errorResponse(
    502,
    "KEEPA_UPSTREAM_ERROR",
    "Keepa a renvoyé une réponse inexploitable. Réessayez plus tard.",
    "keepa",
  );
}

export async function GET(request: Request) {
  const requestUrl = new URL(request.url);
  const asin = normalizeAsin(requestUrl.searchParams.get("asin"));
  if (asin === null) {
    return errorResponse(
      400,
      "INVALID_ASIN",
      "L’ASIN doit contenir exactement 10 lettres ou chiffres.",
      "off",
    );
  }

  const market = normalizeKeepaMarket(requestUrl.searchParams.get("market"));
  if (market === null) {
    return errorResponse(
      400,
      "UNSUPPORTED_MARKET",
      `Marché Amazon non pris en charge par Keepa. Valeurs acceptées : ${Object.keys(KEEPA_MARKETS).join(", ")}.`,
      "off",
    );
  }

  const apiKey = serverKeepaApiKey();
  if (apiKey === null) {
    return errorResponse(
      503,
      "KEEPA_NOT_CONFIGURED",
      "La source Amazon Keepa n’est pas configurée. Aucun résultat de démonstration n’a été substitué.",
      "off",
    );
  }

  const identity = await resolveDevice(request);
  if (!identity.ok) return identity.response;
  const now = new Date();
  const nowIso = now.toISOString();
  const cacheId = `${market}:${asin}`;

  try {
    const cached = await cachedResponse(cacheId, nowIso);
    if (cached !== null) return json(cached);
    const quota = await consumeQuota(identity.device.ownerId, now);
    if (!quota.allowed) {
      return errorResponse(
        429,
        "KEEPA_RATE_LIMITED",
        "Limite de vérifications Keepa atteinte pour cet appareil. Réessayez plus tard.",
        "keepa",
        { "Retry-After": String(quota.retryAfter) },
      );
    }
  } catch {
    return errorResponse(
      503,
      "KEEPA_GUARD_UNAVAILABLE",
      "Le cache et le contrôle de quota Keepa sont temporairement indisponibles.",
      "off",
    );
  }

  const upstreamUrl = new URL(KEEPA_PRODUCT_ENDPOINT);
  upstreamUrl.search = new URLSearchParams({
    key: apiKey,
    domain: String(KEEPA_MARKETS[market].domainId),
    asin,
    history: "1",
    days: "90",
    stats: "90",
    buybox: "1",
    update: "1",
  }).toString();

  const abortController = new AbortController();
  const timeout = setTimeout(() => abortController.abort(), KEEPA_TIMEOUT_MS);

  try {
    const upstreamResponse = await fetch(upstreamUrl, {
      method: "GET",
      headers: { Accept: "application/json" },
      signal: abortController.signal,
    });

    let payload: unknown;
    try {
      payload = await upstreamResponse.json();
    } catch {
      return upstreamErrorResponse("unknown");
    }

    if (upstreamResponse.status === 429) return upstreamErrorResponse("rate_limited");
    if (upstreamResponse.status === 401 || upstreamResponse.status === 403) {
      return upstreamErrorResponse("authentication");
    }
    if (!upstreamResponse.ok) return upstreamErrorResponse("unknown");

    const payloadError = classifyKeepaPayloadError(payload);
    if (payloadError !== null) return upstreamErrorResponse(payloadError);

    const normalized = normalizeKeepaResponse(payload, asin, market);
    if (normalized === null) return upstreamErrorResponse("not_found");

    const fetchedAt = new Date().toISOString();
    const expiresAt = new Date(Date.parse(fetchedAt) + KEEPA_CACHE_TTL_MS).toISOString();
    const responseBody = {
      ok: true,
      mode: "keepa",
      dataKind: "historical-snapshot",
      isLiveRetailerPrice: false,
      fetchedAt,
      ...normalized,
      cache: { hit: false, expiresAt },
    };

    const database = getDb();
    try {
      await database.batch([
        database
          .insert(keepaCache)
          .values({
            id: cacheId,
            market,
            asin,
            responseJson: JSON.stringify(responseBody),
            fetchedAt,
            expiresAt,
          })
          .onConflictDoUpdate({
            target: keepaCache.id,
            set: { responseJson: JSON.stringify(responseBody), fetchedAt, expiresAt },
          }),
        database.delete(keepaCache).where(lt(keepaCache.expiresAt, new Date(Date.now() - 86_400_000).toISOString())),
        database.delete(keepaUsage).where(lt(keepaUsage.windowStart, new Date(Date.now() - 48 * 3_600_000).toISOString())),
      ]);
    } catch {
      console.error("[keepa] Cache write failed");
    }

    return json(responseBody);
  } catch (error) {
    if (error instanceof Error && error.name === "AbortError") {
      return errorResponse(
        504,
        "KEEPA_TIMEOUT",
        "Keepa n’a pas répondu dans le délai prévu. Réessayez plus tard.",
        "keepa",
      );
    }

    return upstreamErrorResponse("unknown");
  } finally {
    clearTimeout(timeout);
  }
}
