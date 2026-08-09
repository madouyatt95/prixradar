import { eq, inArray } from "drizzle-orm";

import { getDb } from "@/db";
import { socialPublications, socialSources } from "@/db/schema";
import { authenticateSocialCollector } from "../server-auth";

export const dynamic = "force-dynamic";

const MAX_BODY_BYTES = 256 * 1024;
const MAX_ITEMS = 40;
const RECENT_NOTIFICATION_MS = 15 * 60_000;

type UnknownRecord = Record<string, unknown>;

type ParsedPublication = {
  id: string;
  sourceId: string;
  externalId: string;
  author: string;
  text: string;
  publicationUrl: string;
  imageUrl: string | null;
  externalUrl: string | null;
  publishedAt: string;
  firstSeenAt: string;
  lastSeenAt: string;
  updatedAt: string;
};

function json(body: unknown, status = 200) {
  return Response.json(body, { status, headers: { "Cache-Control": "no-store" } });
}

function isRecord(value: unknown): value is UnknownRecord {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function stringValue(value: unknown, field: string, maximum: number) {
  if (typeof value !== "string") throw new Error(`${field} est obligatoire.`);
  const cleaned = value.replace(/\r\n?/gu, "\n").trim();
  if (!cleaned || cleaned.length > maximum) throw new Error(`${field} est invalide.`);
  return cleaned;
}

function optionalUrl(value: unknown, field: string) {
  if (value === null || value === undefined || value === "") return null;
  const raw = stringValue(value, field, 2_048);
  const url = new URL(raw);
  if (url.protocol !== "https:" || url.username || url.password) throw new Error(`${field} est invalide.`);
  return url.toString();
}

function publicationUrl(value: unknown, platform: string) {
  const raw = optionalUrl(value, "publicationUrl");
  if (!raw) throw new Error("publicationUrl est obligatoire.");
  const host = new URL(raw).hostname.toLowerCase().replace(/^www\./u, "");
  const allowed = platform === "facebook"
    ? host === "facebook.com" || host === "m.facebook.com"
    : host === "x.com" || host === "twitter.com";
  if (!allowed) throw new Error("publicationUrl ne correspond pas à la plateforme.");
  return raw;
}

function parsePublishedAt(value: unknown) {
  const raw = stringValue(value, "publishedAt", 64);
  const milliseconds = Date.parse(raw);
  if (!Number.isFinite(milliseconds)) throw new Error("publishedAt est invalide.");
  const now = Date.now();
  if (milliseconds > now + 5 * 60_000 || milliseconds < now - 45 * 86_400_000) {
    throw new Error("publishedAt est hors de la période autorisée.");
  }
  return new Date(milliseconds).toISOString();
}

function parseItems(value: unknown, source: typeof socialSources.$inferSelect, scannedAt: string) {
  if (!Array.isArray(value) || value.length > MAX_ITEMS) throw new Error("items doit être une liste courte.");
  const unique = new Map<string, ParsedPublication>();
  for (const candidate of value) {
    if (!isRecord(candidate)) throw new Error("Publication invalide.");
    const externalId = stringValue(candidate.externalId, "externalId", 160);
    if (!/^[A-Za-z0-9._:-]{3,160}$/u.test(externalId)) throw new Error("externalId est invalide.");
    const publishedAt = parsePublishedAt(candidate.publishedAt);
    const item: ParsedPublication = {
      id: `${source.id}:${externalId}`,
      sourceId: source.id,
      externalId,
      author: stringValue(candidate.author, "author", 160),
      text: stringValue(candidate.text, "text", 4_000),
      publicationUrl: publicationUrl(candidate.publicationUrl, source.platform),
      imageUrl: optionalUrl(candidate.imageUrl, "imageUrl"),
      externalUrl: optionalUrl(candidate.externalUrl, "externalUrl"),
      publishedAt,
      firstSeenAt: scannedAt,
      lastSeenAt: scannedAt,
      updatedAt: scannedAt,
    };
    unique.set(item.id, item);
  }
  return [...unique.values()];
}

export async function POST(request: Request) {
  if (!(await authenticateSocialCollector(request))) return json({ ok: false, code: "UNAUTHORIZED" }, 401);
  const declared = Number(request.headers.get("content-length") ?? "0");
  if (Number.isFinite(declared) && declared > MAX_BODY_BYTES) return json({ ok: false, code: "PAYLOAD_TOO_LARGE" }, 413);

  let body: unknown;
  try {
    const text = await request.text();
    if (new TextEncoder().encode(text).byteLength > MAX_BODY_BYTES) return json({ ok: false, code: "PAYLOAD_TOO_LARGE" }, 413);
    body = JSON.parse(text) as unknown;
  } catch {
    return json({ ok: false, code: "INVALID_JSON" }, 400);
  }
  if (!isRecord(body)) return json({ ok: false, code: "INVALID_BODY" }, 400);

  const sourceId = typeof body.sourceId === "string" ? body.sourceId.trim() : "";
  if (!/^(?:facebook:\d{6,20}|x:[a-z0-9_]{1,30})$/u.test(sourceId)) {
    return json({ ok: false, code: "INVALID_SOURCE" }, 400);
  }

  const database = getDb();
  try {
    const [source] = await database.select().from(socialSources).where(eq(socialSources.id, sourceId)).limit(1);
    if (!source || !source.enabled) return json({ ok: false, code: "SOURCE_DISABLED" }, 409);
    const scannedAtMs = Date.parse(typeof body.scannedAt === "string" ? body.scannedAt : "");
    const scannedAt = Number.isFinite(scannedAtMs) ? new Date(scannedAtMs).toISOString() : new Date().toISOString();
    const successful = body.successful === true;
    const items = parseItems(body.items, source, scannedAt);
    const existing = items.length === 0 ? [] : await database.select({ id: socialPublications.id })
      .from(socialPublications).where(inArray(socialPublications.id, items.map((item) => item.id)));
    const existingIds = new Set(existing.map((item) => item.id));
    if (items.length > 0) {
      const statements = items.map((item) => database.insert(socialPublications).values(item).onConflictDoUpdate({
        target: socialPublications.id,
        set: {
          author: item.author,
          text: item.text,
          publicationUrl: item.publicationUrl,
          imageUrl: item.imageUrl,
          externalUrl: item.externalUrl,
          publishedAt: item.publishedAt,
          lastSeenAt: scannedAt,
          updatedAt: scannedAt,
        },
      }));
      const [first, ...rest] = statements;
      if (first) await database.batch([first, ...rest]);
    }
    await database.update(socialSources).set({
      status: successful || items.length > 0 ? "live" : "degraded",
      lastAttemptAt: scannedAt,
      ...(successful || items.length > 0
        ? { lastSuccessAt: scannedAt, lastErrorCode: null }
        : { lastErrorCode: "NO_PUBLICATION_VISIBLE" }),
      updatedAt: scannedAt,
    }).where(eq(socialSources.id, source.id));
    const now = Date.now();
    const newItems = items.filter((item) => !existingIds.has(item.id)).map((item) => ({
      id: item.id,
      sourceId: source.id,
      notificationEligible: now - Date.parse(item.publishedAt) <= RECENT_NOTIFICATION_MS,
    }));
    return json({ ok: true, accepted: items.length, newItems }, 202);
  } catch (error) {
    const message = error instanceof Error ? error.message : "";
    if (/invalide|obligatoire|période|liste/u.test(message)) return json({ ok: false, code: "INVALID_PUBLICATION", error: message }, 422);
    if (message.includes("no such table")) return json({ ok: false, code: "SOCIAL_NOT_READY" }, 503);
    console.error(JSON.stringify({ event: "social_ingest_failed", sourceId, error: message.slice(0, 160) }));
    return json({ ok: false, code: "SOCIAL_INGEST_FAILED" }, 500);
  }
}
