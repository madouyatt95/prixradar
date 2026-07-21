import { env } from "cloudflare:workers";

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

type ApiErrorCode =
  | "INVALID_ASIN"
  | "UNSUPPORTED_MARKET"
  | "KEEPA_NOT_CONFIGURED"
  | "KEEPA_TIMEOUT"
  | "KEEPA_RATE_LIMITED"
  | "KEEPA_AUTH_ERROR"
  | "KEEPA_PRODUCT_NOT_FOUND"
  | "KEEPA_UPSTREAM_ERROR";

function json(body: unknown, status = 200) {
  return Response.json(body, {
    status,
    headers: {
      "Cache-Control": "no-store",
    },
  });
}

function errorResponse(status: number, code: ApiErrorCode, message: string, mode: "off" | "keepa") {
  return json(
    {
      ok: false,
      mode,
      code,
      message,
    },
    status,
  );
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

    return json({
      ok: true,
      mode: "keepa",
      dataKind: "historical-snapshot",
      isLiveRetailerPrice: false,
      fetchedAt: new Date().toISOString(),
      ...normalized,
    });
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
