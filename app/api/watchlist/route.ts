import { and, desc, eq, sql } from "drizzle-orm";
import { getDb } from "../../../db";
import { watchlistItems } from "../../../db/schema";
import {
  deviceError,
  deviceJson,
  resolveDevice,
  type DeviceContext,
} from "../push/device";

const SUPPORTED_SOURCES = new Set([
  "amazon",
  "boulanger",
  "cdiscount",
  "darty",
]);
const KEEPA_MARKETS = new Set(["DE", "ES", "FR", "GB", "IT"]);

type WatchlistPayload = {
  productId?: unknown;
  source?: unknown;
  title?: unknown;
  market?: unknown;
  price?: unknown;
  priceCents?: unknown;
  url?: unknown;
};

function databaseError(device: DeviceContext, error: unknown) {
  const message = error instanceof Error ? error.message : String(error);

  if (message.includes("no such table") || message.includes("watchlist_items")) {
    return deviceError(
      device,
      503,
      "watchlist_not_ready",
      "La liste de suivi n’est pas encore initialisée."
    );
  }

  if (message.includes("D1 binding") || message.includes("env.DB")) {
    return deviceError(
      device,
      503,
      "database_unavailable",
      "La base de données de la liste de suivi est indisponible."
    );
  }

  console.error("[watchlist] D1 request failed");
  return deviceError(
    device,
    500,
    "watchlist_failed",
    "Impossible de mettre à jour la liste de suivi pour le moment."
  );
}

function cleanRequiredString(
  value: unknown,
  field: string,
  maxLength: number
): string {
  if (typeof value !== "string") {
    throw new Error(`${field} doit être une chaîne de caractères.`);
  }

  const cleaned = value.trim();
  if (!cleaned) throw new Error(`${field} est obligatoire.`);
  if (cleaned.length > maxLength) {
    throw new Error(`${field} ne doit pas dépasser ${maxLength} caractères.`);
  }
  if (/\p{Cc}/u.test(cleaned)) {
    throw new Error(`${field} contient des caractères non valides.`);
  }

  return cleaned;
}

function parsePayload(payload: WatchlistPayload) {
  const productId = cleanRequiredString(payload.productId, "productId", 120);
  if (!/^[\p{L}\p{N}._:/-]+$/u.test(productId)) {
    throw new Error("productId contient des caractères non valides.");
  }

  const source = cleanRequiredString(payload.source, "source", 24).toLowerCase();
  if (!SUPPORTED_SOURCES.has(source)) {
    throw new Error("source doit être amazon, boulanger, cdiscount ou darty.");
  }

  const title = cleanRequiredString(payload.title, "title", 240);
  const market = cleanRequiredString(payload.market, "market", 8).toUpperCase();
  if (!/^[A-Z]{2,8}$/.test(market)) {
    throw new Error("market doit être un code de marché valide, par exemple FR.");
  }
  if (source === "amazon" && !KEEPA_MARKETS.has(market)) {
    throw new Error("Keepa couvre ici les marchés Amazon DE, ES, FR, GB et IT.");
  }
  if (source !== "amazon" && market !== "FR") {
    throw new Error("Boulanger, Cdiscount et Darty utilisent le marché FR.");
  }

  let priceCents: number;
  if (typeof payload.priceCents === "number") {
    priceCents = payload.priceCents;
  } else if (typeof payload.price === "number") {
    priceCents = Math.round(payload.price * 100);
  } else {
    throw new Error("priceCents (ou price en euros) est obligatoire.");
  }

  if (
    !Number.isSafeInteger(priceCents) ||
    priceCents < 0 ||
    priceCents > 100_000_000
  ) {
    throw new Error("Le prix doit être compris entre 0 et 1 000 000 EUR.");
  }

  const rawUrl = cleanRequiredString(payload.url, "url", 2_048);
  let url: URL;
  try {
    url = new URL(rawUrl);
  } catch {
    throw new Error("url doit être une adresse HTTPS valide.");
  }
  if (url.protocol !== "https:") {
    throw new Error("url doit utiliser HTTPS.");
  }

  return {
    productId,
    source,
    title,
    market,
    priceCents,
    url: url.toString(),
  };
}

function serializeItem(item: typeof watchlistItems.$inferSelect) {
  return {
    id: item.id,
    productId: item.productId,
    source: item.source,
    title: item.title,
    market: item.market,
    priceCents: item.priceCents,
    price: item.priceCents / 100,
    currency: item.market === "GB" ? "GBP" : "EUR",
    url: item.url,
    createdAt: item.createdAt,
    updatedAt: item.updatedAt,
  };
}

export async function GET(request: Request) {
  const identity = await resolveDevice(request);
  if (!identity.ok) return identity.response;
  const device = identity.device;

  try {
    const items = await getDb()
      .select()
      .from(watchlistItems)
      .where(eq(watchlistItems.ownerId, device.ownerId))
      .orderBy(desc(watchlistItems.updatedAt), desc(watchlistItems.id));

    return deviceJson(device, {
      ok: true,
      count: items.length,
      items: items.map(serializeItem),
    });
  } catch (error) {
    return databaseError(device, error);
  }
}

export async function POST(request: Request) {
  const identity = await resolveDevice(request);
  if (!identity.ok) return identity.response;
  const device = identity.device;
  let rawPayload: WatchlistPayload;

  try {
    rawPayload = (await request.json()) as WatchlistPayload;
  } catch {
    return deviceError(device, 400, "invalid_json", "Le corps JSON est invalide.");
  }

  let payload: ReturnType<typeof parsePayload>;
  try {
    payload = parsePayload(rawPayload);
  } catch (error) {
    return deviceError(
      device,
      400,
      "invalid_watchlist_item",
      error instanceof Error ? error.message : "Les données sont invalides."
    );
  }

  try {
    const [item] = await getDb()
      .insert(watchlistItems)
      .values({ ownerId: device.ownerId, ...payload })
      .onConflictDoUpdate({
        target: [
          watchlistItems.ownerId,
          watchlistItems.productId,
          watchlistItems.source,
          watchlistItems.market,
        ],
        set: {
          title: payload.title,
          priceCents: payload.priceCents,
          url: payload.url,
          updatedAt: sql`CURRENT_TIMESTAMP`,
        },
      })
      .returning();

    return deviceJson(
      device,
      { ok: true, saved: true, item: serializeItem(item) },
      { status: 201 }
    );
  } catch (error) {
    return databaseError(device, error);
  }
}

export async function DELETE(request: Request) {
  const identity = await resolveDevice(request);
  if (!identity.ok) return identity.response;
  const device = identity.device;
  const search = new URL(request.url).searchParams;
  let body: Record<string, unknown> = {};

  if (request.headers.get("content-type")?.includes("application/json")) {
    try {
      const parsed = await request.json();
      if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
        return deviceError(
          device,
          400,
          "invalid_json",
          "Le corps JSON doit être un objet."
        );
      }
      body = parsed as Record<string, unknown>;
    } catch {
      return deviceError(device, 400, "invalid_json", "Le corps JSON est invalide.");
    }
  }

  const rawId = body.id ?? search.get("id");
  const id = typeof rawId === "number" ? rawId : Number(rawId);

  try {
    let removed: Array<{ id: number }>;

    if (Number.isSafeInteger(id) && id > 0) {
      removed = await getDb()
        .delete(watchlistItems)
        .where(
          and(
            eq(watchlistItems.ownerId, device.ownerId),
            eq(watchlistItems.id, id)
          )
        )
        .returning({ id: watchlistItems.id });
    } else {
      const productId = body.productId ?? search.get("productId");
      const source = body.source ?? search.get("source");
      const market = body.market ?? search.get("market");

      let identity: Pick<
        ReturnType<typeof parsePayload>,
        "productId" | "source" | "market"
      >;
      try {
        identity = {
          productId: cleanRequiredString(productId, "productId", 120),
          source: cleanRequiredString(source, "source", 24).toLowerCase(),
          market: cleanRequiredString(market, "market", 8).toUpperCase(),
        };
      } catch (error) {
        return deviceError(
          device,
          400,
          "missing_watchlist_identity",
          error instanceof Error
            ? error.message
            : "id ou productId/source/market est obligatoire."
        );
      }

      if (!SUPPORTED_SOURCES.has(identity.source)) {
        return deviceError(
          device,
          400,
          "invalid_watchlist_identity",
          "source doit être amazon, boulanger, cdiscount ou darty."
        );
      }
      if (!/^[\p{L}\p{N}._:/-]+$/u.test(identity.productId)) {
        return deviceError(
          device,
          400,
          "invalid_watchlist_identity",
          "productId contient des caractères non valides."
        );
      }
      if (!/^[A-Z]{2,8}$/.test(identity.market)) {
        return deviceError(
          device,
          400,
          "invalid_watchlist_identity",
          "market doit être un code de marché valide, par exemple FR."
        );
      }
      if (
        (identity.source === "amazon" && !KEEPA_MARKETS.has(identity.market)) ||
        (identity.source !== "amazon" && identity.market !== "FR")
      ) {
        return deviceError(
          device,
          400,
          "invalid_watchlist_identity",
          "La source et le marché ne correspondent pas."
        );
      }

      removed = await getDb()
        .delete(watchlistItems)
        .where(
          and(
            eq(watchlistItems.ownerId, device.ownerId),
            eq(watchlistItems.productId, identity.productId),
            eq(watchlistItems.source, identity.source),
            eq(watchlistItems.market, identity.market)
          )
        )
        .returning({ id: watchlistItems.id });
    }

    return deviceJson(device, {
      ok: true,
      removed: removed.length,
      removedIds: removed.map((item) => item.id),
    });
  } catch (error) {
    return databaseError(device, error);
  }
}
