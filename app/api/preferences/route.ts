import { eq, sql } from "drizzle-orm";

import { getDb } from "../../../db";
import { userPreferences } from "../../../db/schema";
import {
  deviceDatabaseError,
  deviceError,
  deviceJson,
  readJsonObject,
  resolveDevice,
} from "../push/device";

export const dynamic = "force-dynamic";

const DEFAULT_PREFERENCES = {
  minScore: 75,
  quietHours: false,
  quietStart: "22:00",
  quietEnd: "08:00",
  notificationEnabled: true,
} as const;

const EDITABLE_FIELDS = new Set([
  "minScore",
  "quietHours",
  "quietStart",
  "quietEnd",
  "notificationEnabled",
]);

type PreferencesPatch = {
  minScore?: number;
  quietHours?: boolean;
  quietStart?: string;
  quietEnd?: string;
  notificationEnabled?: boolean;
};

function serializePreferences(
  value: typeof userPreferences.$inferSelect
) {
  return {
    minScore: value.minScore,
    quietHours: value.quietHours,
    quietStart: value.quietStart,
    quietEnd: value.quietEnd,
    timezone: value.timezone,
    notificationEnabled: value.notificationEnabled,
    createdAt: value.createdAt,
    updatedAt: value.updatedAt,
  };
}

function parseTime(value: unknown, field: string) {
  if (typeof value !== "string" || !/^(?:[01]\d|2[0-3]):[0-5]\d$/.test(value)) {
    throw new Error(`${field} doit respecter le format HH:mm.`);
  }
  return value;
}

function parsePatch(body: Record<string, unknown>) {
  const unknownFields = Object.keys(body).filter(
    (field) => !EDITABLE_FIELDS.has(field)
  );
  if (unknownFields.length > 0) {
    throw new Error(`Champ inconnu : ${unknownFields[0]}.`);
  }
  if (Object.keys(body).length === 0) {
    throw new Error("Au moins une préférence doit être fournie.");
  }

  const patch: PreferencesPatch = {};

  if (body.minScore !== undefined) {
    if (
      typeof body.minScore !== "number" ||
      !Number.isInteger(body.minScore) ||
      body.minScore < 60 ||
      body.minScore > 95
    ) {
      throw new Error("minScore doit être un entier compris entre 60 et 95.");
    }
    patch.minScore = body.minScore;
  }

  for (const field of ["quietHours", "notificationEnabled"] as const) {
    if (body[field] !== undefined) {
      if (typeof body[field] !== "boolean") {
        throw new Error(`${field} doit être un booléen.`);
      }
      patch[field] = body[field];
    }
  }

  if (body.quietStart !== undefined) {
    patch.quietStart = parseTime(body.quietStart, "quietStart");
  }
  if (body.quietEnd !== undefined) {
    patch.quietEnd = parseTime(body.quietEnd, "quietEnd");
  }

  return patch;
}

async function ensurePreferences(ownerId: string) {
  const db = getDb();
  await db
    .insert(userPreferences)
    .values({ ownerId, ...DEFAULT_PREFERENCES })
    .onConflictDoNothing({ target: userPreferences.ownerId });

  const [preferences] = await db
    .select()
    .from(userPreferences)
    .where(eq(userPreferences.ownerId, ownerId))
    .limit(1);
  if (!preferences) {
    throw new Error("Unable to create user preferences");
  }
  return preferences;
}

export async function GET(request: Request) {
  const identity = await resolveDevice(request);
  if (!identity.ok) return identity.response;
  const device = identity.device;

  try {
    const preferences = await ensurePreferences(device.ownerId);
    return deviceJson(device, {
      ok: true,
      preferences: serializePreferences(preferences),
    });
  } catch (error) {
    return deviceDatabaseError(device, error);
  }
}

export async function PUT(request: Request) {
  const identity = await resolveDevice(request);
  if (!identity.ok) return identity.response;
  const device = identity.device;
  const body = await readJsonObject(request);
  if (body === null) {
    return deviceError(device, 400, "invalid_json", "Le corps JSON est invalide.");
  }

  let patch: ReturnType<typeof parsePatch>;
  try {
    patch = parsePatch(body);
  } catch (error) {
    return deviceError(
      device,
      400,
      "invalid_preferences",
      error instanceof Error ? error.message : "Les préférences sont invalides."
    );
  }

  try {
    await ensurePreferences(device.ownerId);
    const [preferences] = await getDb()
      .update(userPreferences)
      .set({ ...patch, updatedAt: sql`CURRENT_TIMESTAMP` })
      .where(eq(userPreferences.ownerId, device.ownerId))
      .returning();

    return deviceJson(device, {
      ok: true,
      preferences: serializePreferences(preferences),
    });
  } catch (error) {
    return deviceDatabaseError(device, error);
  }
}
