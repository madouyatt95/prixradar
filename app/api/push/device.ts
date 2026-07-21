import { readServerEnv } from "./server-env";

const SECURE_DEVICE_COOKIE = "__Host-prixradar_device";
const HTTP_DEVICE_COOKIE = "prixradar_device";
const LOCAL_DEV_DEVICE_COOKIE = "prixradar_device_dev";
const COOKIE_MAX_AGE = 60 * 60 * 24 * 365;
const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const SIGNATURE_PATTERN = /^[A-Za-z0-9_-]{43}$/;

export type DeviceContext = {
  ownerId: string;
  setCookie?: string;
};

export type DeviceResolution =
  | { ok: true; device: DeviceContext }
  | { ok: false; response: Response };

function cookieValue(request: Request, name: string) {
  const rawCookie = request.headers.get("cookie") ?? "";

  for (const cookie of rawCookie.split(";")) {
    const separator = cookie.indexOf("=");
    if (separator === -1) continue;
    if (cookie.slice(0, separator).trim() !== name) continue;

    try {
      return decodeURIComponent(cookie.slice(separator + 1).trim());
    } catch {
      return null;
    }
  }

  return null;
}

function isLocalHttpDevelopment(url: URL) {
  const localHostname =
    url.hostname === "localhost" ||
    url.hostname === "127.0.0.1" ||
    url.hostname === "::1" ||
    url.hostname === "[::1]";
  return (
    url.protocol === "http:" &&
    localHostname &&
    process.env.NODE_ENV !== "production"
  );
}

function deviceSecret() {
  const value = readServerEnv("DEVICE_COOKIE_SECRET");
  return value !== null && value.length >= 32 ? value : null;
}

function bytesToBase64Url(value: ArrayBuffer) {
  let binary = "";
  for (const byte of new Uint8Array(value)) {
    binary += String.fromCharCode(byte);
  }
  return btoa(binary)
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/u, "");
}

function base64UrlToBytes(value: string) {
  const base64 = value.replace(/-/g, "+").replace(/_/g, "/");
  const padded = base64.padEnd(Math.ceil(base64.length / 4) * 4, "=");
  const binary = atob(padded);
  return Uint8Array.from(binary, (character) => character.charCodeAt(0));
}

async function hmacKey(secret: string) {
  return crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign", "verify"]
  );
}

async function signDeviceId(ownerId: string, secret: string) {
  const key = await hmacKey(secret);
  const signature = await crypto.subtle.sign(
    "HMAC",
    key,
    new TextEncoder().encode(ownerId)
  );
  return bytesToBase64Url(signature);
}

async function verifySignedDevice(value: string | null, secret: string) {
  if (value === null) return null;
  const separator = value.indexOf(".");
  if (separator === -1 || value.indexOf(".", separator + 1) !== -1) return null;

  const ownerId = value.slice(0, separator);
  const signature = value.slice(separator + 1);
  if (!UUID_PATTERN.test(ownerId) || !SIGNATURE_PATTERN.test(signature)) {
    return null;
  }

  try {
    const key = await hmacKey(secret);
    const valid = await crypto.subtle.verify(
      "HMAC",
      key,
      base64UrlToBytes(signature),
      new TextEncoder().encode(ownerId)
    );
    return valid ? ownerId : null;
  } catch {
    return null;
  }
}

function serializeCookie(
  name: string,
  value: string,
  secure: boolean
) {
  return `${name}=${encodeURIComponent(value)}; Path=/; Max-Age=${COOKIE_MAX_AGE}; HttpOnly; SameSite=Lax${secure ? "; Secure" : ""}`;
}

export async function readDevice(request: Request): Promise<DeviceContext> {
  const requestUrl = new URL(request.url);
  const secureRequest = requestUrl.protocol === "https:";
  const localHttpDevelopment = isLocalHttpDevelopment(requestUrl);
  const secret = deviceSecret();

  if (!secureRequest && !localHttpDevelopment) {
    throw new Error("DEVICE_IDENTITY_REQUIRES_HTTPS");
  }

  if (secret === null) {
    if (!localHttpDevelopment) {
      throw new Error("DEVICE_IDENTITY_UNAVAILABLE");
    }

    const existing = cookieValue(request, LOCAL_DEV_DEVICE_COOKIE);
    const ownerId = existing?.endsWith(".local-dev")
      ? existing.slice(0, -".local-dev".length)
      : "";
    if (UUID_PATTERN.test(ownerId)) return { ownerId };

    const replacementId = crypto.randomUUID();
    return {
      ownerId: replacementId,
      setCookie: serializeCookie(
        LOCAL_DEV_DEVICE_COOKIE,
        `${replacementId}.local-dev`,
        false
      ),
    };
  }

  const cookieName = secureRequest ? SECURE_DEVICE_COOKIE : HTTP_DEVICE_COOKIE;
  const existingOwnerId = await verifySignedDevice(
    cookieValue(request, cookieName),
    secret
  );
  if (existingOwnerId !== null) return { ownerId: existingOwnerId };

  const ownerId = crypto.randomUUID();
  const signature = await signDeviceId(ownerId, secret);
  return {
    ownerId,
    setCookie: serializeCookie(
      cookieName,
      `${ownerId}.${signature}`,
      secureRequest
    ),
  };
}

export async function resolveDevice(request: Request): Promise<DeviceResolution> {
  try {
    return { ok: true, device: await readDevice(request) };
  } catch {
    return {
      ok: false,
      response: Response.json(
        {
          ok: false,
          code: "device_identity_unavailable",
          error: "L’identité sécurisée de cet appareil est indisponible.",
        },
        {
          status: 503,
          headers: { "Cache-Control": "no-store" },
        }
      ),
    };
  }
}

export function deviceJson(
  device: DeviceContext,
  body: unknown,
  init: ResponseInit = {}
) {
  const headers = new Headers(init.headers);
  headers.set("Cache-Control", "no-store");
  if (device.setCookie) headers.set("Set-Cookie", device.setCookie);
  return Response.json(body, { ...init, headers });
}

export function deviceError(
  device: DeviceContext,
  status: number,
  code: string,
  message: string
) {
  return deviceJson(device, { ok: false, code, error: message }, { status });
}

export function deviceDatabaseError(device: DeviceContext, error: unknown) {
  const message = error instanceof Error ? error.message : String(error);

  if (message.includes("no such table")) {
    return deviceError(
      device,
      503,
      "persistence_not_ready",
      "Le service de notifications n’est pas encore initialisé."
    );
  }

  if (message.includes("D1 binding") || message.includes("env.DB")) {
    return deviceError(
      device,
      503,
      "database_unavailable",
      "Le service de notifications est temporairement indisponible."
    );
  }

  console.error("[notifications] D1 request failed");
  return deviceError(
    device,
    500,
    "persistence_failed",
    "Impossible d’enregistrer ce réglage pour le moment."
  );
}

export async function readJsonObject(request: Request, maximumBytes = 16 * 1024) {
  const declared = Number(request.headers.get("content-length") ?? "0");
  if (Number.isFinite(declared) && declared > maximumBytes) return null;

  let text: string;
  try {
    text = await request.text();
  } catch {
    return null;
  }
  if (new TextEncoder().encode(text).byteLength > maximumBytes) return null;

  let parsed: unknown;
  try {
    parsed = JSON.parse(text) as unknown;
  } catch {
    return null;
  }

  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    return null;
  }

  return parsed as Record<string, unknown>;
}
