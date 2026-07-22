import { and, desc, eq, gt, inArray } from "drizzle-orm";

import { getDb } from "@/db";
import { inspectionRequests } from "@/db/schema";
import { parseCoverageProductUrl } from "@/lib/merchant-url";
import { runtimeEnv as env } from "@/lib/runtime-env";
import { isPartnerSourceAuthorized } from "@/lib/source-registry";
import { deviceDatabaseError, deviceError, deviceJson, readJsonObject, resolveDevice } from "../push/device";

export const dynamic = "force-dynamic";

function parsedResult(value: string) {
  try { return JSON.parse(value) as unknown; } catch { return {}; }
}

function authorizedPartnerSources() {
  const value = (env as unknown as { AUTHORIZED_PARTNER_SOURCES?: unknown }).AUTHORIZED_PARTNER_SOURCES;
  return typeof value === "string" ? value : undefined;
}

export async function GET(request: Request) {
  const identity = await resolveDevice(request);
  if (!identity.ok) return identity.response;
  const id = new URL(request.url).searchParams.get("id")?.trim() ?? "";
  try {
    const rows = await getDb().select().from(inspectionRequests).where(and(
      eq(inspectionRequests.ownerId, identity.device.ownerId),
      ...(id ? [eq(inspectionRequests.id, id)] : []),
    )).orderBy(desc(inspectionRequests.requestedAt)).limit(id ? 1 : 20);
    return deviceJson(identity.device, { ok: true, items: rows.map((row) => ({ ...row, result: parsedResult(row.resultJson) })) });
  } catch (error) {
    return deviceDatabaseError(identity.device, error);
  }
}

export async function POST(request: Request) {
  const identity = await resolveDevice(request);
  if (!identity.ok) return identity.response;
  const body = await readJsonObject(request);
  const merchant = parseCoverageProductUrl(typeof body?.url === "string" ? body.url.trim() : "");
  if (!merchant) {
    return deviceError(
      identity.device,
      400,
      "unsupported_url",
      "Partagez l’URL d’une fiche produit d’une enseigne prise en charge.",
    );
  }
  if (!isPartnerSourceAuthorized(merchant.source, authorizedPartnerSources())) {
    return deviceError(
      identity.device,
      409,
      "partner_authorization_required",
      "Cette enseigne sera analysable après activation de son flux partenaire officiel.",
    );
  }
  try {
    const recentAfter = new Date(Date.now() - 2 * 60_000).toISOString();
    const [existing] = await getDb().select().from(inspectionRequests).where(and(
      eq(inspectionRequests.ownerId, identity.device.ownerId),
      eq(inspectionRequests.url, merchant.url),
      inArray(inspectionRequests.status, ["pending", "processing"]),
      gt(inspectionRequests.requestedAt, recentAfter),
    )).orderBy(desc(inspectionRequests.requestedAt)).limit(1);
    if (existing) return deviceJson(identity.device, { ok: true, duplicate: true, item: { ...existing, result: parsedResult(existing.resultJson) } });
    const now = new Date().toISOString();
    const [item] = await getDb().insert(inspectionRequests).values({
      id: `inspect:${crypto.randomUUID()}`,
      ownerId: identity.device.ownerId,
      url: merchant.url,
      source: merchant.source,
      market: merchant.market,
      status: "pending",
      requestedAt: now,
      updatedAt: now,
    }).returning();
    return deviceJson(identity.device, { ok: true, item: { ...item, result: {} } }, { status: 202 });
  } catch (error) {
    return deviceDatabaseError(identity.device, error);
  }
}
