import { eq, sql } from "drizzle-orm";

import { getDb } from "@/db";
import { privacyConsents } from "@/db/schema";
import { deviceDatabaseError, deviceError, deviceJson, readJsonObject, resolveDevice } from "../push/device";

export const dynamic = "force-dynamic";
const POLICY_VERSION = "2026-07";

async function ensureConsent(ownerId: string) {
  const database = getDb();
  await database.insert(privacyConsents).values({ ownerId, policyVersion: POLICY_VERSION }).onConflictDoNothing();
  const [consent] = await database.select().from(privacyConsents).where(eq(privacyConsents.ownerId, ownerId)).limit(1);
  if (!consent) throw new Error("Consent unavailable");
  return consent;
}

export async function GET(request: Request) {
  const identity = await resolveDevice(request);
  if (!identity.ok) return identity.response;
  try {
    return deviceJson(identity.device, { ok: true, consent: await ensureConsent(identity.device.ownerId) });
  } catch (error) {
    return deviceDatabaseError(identity.device, error);
  }
}

export async function PUT(request: Request) {
  const identity = await resolveDevice(request);
  if (!identity.ok) return identity.response;
  const body = await readJsonObject(request);
  if (!body || Object.keys(body).some((key) => !["analytics", "affiliateLinks"].includes(key))) {
    return deviceError(identity.device, 400, "invalid_consent", "Choix de consentement invalide.");
  }
  const patch: { analytics?: boolean; affiliateLinks?: boolean } = {};
  for (const field of ["analytics", "affiliateLinks"] as const) {
    if (body[field] !== undefined) {
      if (typeof body[field] !== "boolean") return deviceError(identity.device, 400, "invalid_consent", `${field} doit être un booléen.`);
      patch[field] = body[field];
    }
  }
  try {
    await ensureConsent(identity.device.ownerId);
    const [consent] = await getDb().update(privacyConsents).set({ ...patch, policyVersion: POLICY_VERSION, updatedAt: sql`CURRENT_TIMESTAMP` })
      .where(eq(privacyConsents.ownerId, identity.device.ownerId)).returning();
    return deviceJson(identity.device, { ok: true, consent });
  } catch (error) {
    return deviceDatabaseError(identity.device, error);
  }
}
