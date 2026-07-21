import { runtimeEnv as env } from "@/lib/runtime-env";

type JsonRecord = Record<string, unknown>;
type AccessIdentity = { email: string; subject: string };

let cachedJwks: { domain: string; expiresAt: number; keys: JsonWebKey[] } | null = null;

function serverValue(name: string) {
  const workerValue = (env as unknown as Record<string, unknown>)[name];
  if (typeof workerValue === "string" && workerValue.trim()) return workerValue.trim();
  const nodeValue = process.env[name];
  return typeof nodeValue === "string" && nodeValue.trim() ? nodeValue.trim() : null;
}

function accessDomain() {
  const raw = serverValue("CF_ACCESS_TEAM_DOMAIN");
  if (!raw) return null;
  const hostname = raw.replace(/^https?:\/\//u, "").replace(/\/$/u, "").toLowerCase();
  return /^[a-z0-9-]+\.cloudflareaccess\.com$/u.test(hostname) ? hostname : null;
}

function base64Url(value: string) {
  const normalized = value.replace(/-/gu, "+").replace(/_/gu, "/");
  const padded = normalized.padEnd(Math.ceil(normalized.length / 4) * 4, "=");
  return Uint8Array.from(atob(padded), (character) => character.charCodeAt(0));
}

function jsonPart(value: string): JsonRecord | null {
  try {
    const parsed: unknown = JSON.parse(new TextDecoder().decode(base64Url(value)));
    return typeof parsed === "object" && parsed !== null && !Array.isArray(parsed)
      ? parsed as JsonRecord
      : null;
  } catch {
    return null;
  }
}

async function accessKeys(domain: string) {
  if (cachedJwks?.domain === domain && cachedJwks.expiresAt > Date.now()) return cachedJwks.keys;
  const response = await fetch(`https://${domain}/cdn-cgi/access/certs`, {
    headers: { accept: "application/json" },
    signal: AbortSignal.timeout(5_000),
  });
  if (!response.ok) throw new Error("Cloudflare Access certificates unavailable");
  const payload = await response.json() as { keys?: unknown };
  const keys = Array.isArray(payload.keys)
    ? payload.keys.filter((key): key is JsonWebKey => typeof key === "object" && key !== null)
    : [];
  if (keys.length === 0) throw new Error("Cloudflare Access certificates invalid");
  cachedJwks = { domain, keys, expiresAt: Date.now() + 10 * 60_000 };
  return keys;
}

async function verifyAccessJwt(token: string, domain: string, audience: string): Promise<AccessIdentity | null> {
  const parts = token.split(".");
  if (parts.length !== 3) return null;
  const header = jsonPart(parts[0]);
  const payload = jsonPart(parts[1]);
  if (!header || !payload || header.alg !== "RS256" || typeof header.kid !== "string") return null;
  const jwk = (await accessKeys(domain)).find((key) =>
    (key as JsonWebKey & { kid?: string }).kid === header.kid && key.kty === "RSA"
  );
  if (!jwk) return null;
  const key = await crypto.subtle.importKey(
    "jwk",
    jwk,
    { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" },
    false,
    ["verify"],
  );
  const valid = await crypto.subtle.verify(
    "RSASSA-PKCS1-v1_5",
    key,
    base64Url(parts[2]),
    new TextEncoder().encode(`${parts[0]}.${parts[1]}`),
  );
  if (!valid) return null;
  const now = Math.floor(Date.now() / 1_000);
  const audiences = Array.isArray(payload.aud) ? payload.aud : [payload.aud];
  if (
    typeof payload.exp !== "number" || payload.exp <= now ||
    (typeof payload.nbf === "number" && payload.nbf > now + 30) ||
    payload.iss !== `https://${domain}` ||
    !audiences.includes(audience) ||
    typeof payload.email !== "string" ||
    typeof payload.sub !== "string"
  ) return null;
  return { email: payload.email.trim().toLowerCase(), subject: payload.sub };
}

function allowedEmails() {
  const value = serverValue("ADMIN_EMAILS");
  return value
    ? new Set(value.split(",").map((email) => email.trim().toLowerCase()).filter(Boolean))
    : null;
}

export function adminConfigured() {
  return accessDomain() !== null && serverValue("CF_ACCESS_AUD") !== null && allowedEmails() !== null;
}

export function adminJson(body: unknown, status = 200) {
  return Response.json(body, { status, headers: { "Cache-Control": "no-store" } });
}

export async function authorizeAdmin(request: Request) {
  if (process.env.NODE_ENV !== "production" && serverValue("ADMIN_EMAILS") === null) {
    return { ok: true as const, email: "admin@local.prixradar", subject: "local" };
  }
  const domain = accessDomain();
  const audience = serverValue("CF_ACCESS_AUD");
  const allowed = allowedEmails();
  if (!domain || !audience || !allowed) {
    return {
      ok: false as const,
      response: adminJson({
        ok: false,
        code: "ADMIN_ACCESS_NOT_CONFIGURED",
        error: "Cloudflare Access n’est pas encore configuré pour le pilotage.",
      }, 503),
    };
  }
  const token = request.headers.get("cf-access-jwt-assertion")?.trim() ?? "";
  try {
    const identity = token ? await verifyAccessJwt(token, domain, audience) : null;
    if (!identity || !allowed.has(identity.email)) {
      return {
        ok: false as const,
        response: adminJson({
          ok: false,
          code: "ADMIN_UNAUTHORIZED",
          error: "Accès administrateur Cloudflare requis.",
          authPath: `/cdn-cgi/access/login?redirect_url=${encodeURIComponent(new URL(request.url).origin)}`,
        }, 401),
      };
    }
    return { ok: true as const, ...identity };
  } catch {
    return {
      ok: false as const,
      response: adminJson({ ok: false, code: "ADMIN_ACCESS_UNAVAILABLE", error: "Validation Cloudflare Access indisponible." }, 503),
    };
  }
}
