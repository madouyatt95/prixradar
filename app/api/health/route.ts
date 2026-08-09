import { runtimeEnv as env } from "@/lib/runtime-env";
import { adminConfigured } from "@/lib/admin";

export const dynamic = "force-dynamic";

function configured(key: string) {
  const workerValue = env[key];
  const nodeValue = process.env[key];
  return (
    (typeof workerValue === "string" && workerValue.trim().length > 0) ||
    (typeof nodeValue === "string" && nodeValue.trim().length > 0)
  );
}

export async function GET() {
  let database = false;
  let dealabsLastSyncAt: string | null = null;
  let socialLastSyncAt: string | null = null;

  try {
    const result = await env.DB.prepare("SELECT 1 AS ok").first<{ ok: number }>();
    database = result?.ok === 1;
    const dealabs = await env.DB.prepare("SELECT last_seen_at AS lastSeenAt FROM community_signals WHERE provider='dealabs' ORDER BY last_seen_at DESC LIMIT 1").first<{ lastSeenAt: string }>();
    dealabsLastSyncAt = dealabs?.lastSeenAt ?? null;
    const social = await env.DB.prepare("SELECT last_success_at AS lastSuccessAt FROM social_sources WHERE enabled=1 AND platform='facebook' ORDER BY last_success_at DESC LIMIT 1").first<{ lastSuccessAt: string }>();
    socialLastSyncAt = social?.lastSuccessAt ?? null;
  } catch {
    try {
      const result = await env.DB.prepare("SELECT 1 AS ok").first<{ ok: number }>();
      database = result?.ok === 1;
    } catch {
      database = false;
    }
  }

  const dealabsAgeMs = dealabsLastSyncAt ? Date.now() - Date.parse(dealabsLastSyncAt) : Number.POSITIVE_INFINITY;
  const socialAgeMs = socialLastSyncAt ? Date.now() - Date.parse(socialLastSyncAt) : Number.POSITIVE_INFINITY;

  const body = {
    ok: database,
    service: "prixradar",
    version: "0.11.4",
    checkedAt: new Date().toISOString(),
    runtime: database ? "cloudflare-d1" : process.env.VERCEL === "1" ? "vercel-preview" : "unconfigured",
    alertDeliveryMode: ((env as unknown as { ALERT_DELIVERY_MODE?: unknown }).ALERT_DELIVERY_MODE ?? process.env.ALERT_DELIVERY_MODE) === "live" ? "live" : "shadow",
    capabilities: {
      database,
      keepa: configured("KEEPA_API_KEY"),
      ingestion: configured("INGEST_SECRET"),
      deviceIdentity: configured("DEVICE_COOKIE_SECRET"),
      pushSubscriptions: configured("VAPID_PUBLIC_KEY"),
      pushDeliveryCredentials:
        configured("VAPID_PUBLIC_KEY") &&
        configured("VAPID_PRIVATE_KEY") &&
        configured("PUSH_DELIVERY_SECRET"),
      administration: configured("ADMIN_EMAILS"),
      cloudflareAccess: adminConfigured(),
      affiliateLinks: configured("AMAZON_ASSOCIATE_TAG"),
      dealabsTrend: dealabsAgeMs >= 0 && dealabsAgeMs <= 15 * 60_000,
      socialPublications: socialAgeMs >= 0 && socialAgeMs <= 15 * 60_000,
    },
    dealabsLastSyncAt,
    socialLastSyncAt,
  };

  return Response.json(body, {
    status: database ? 200 : 503,
    headers: { "Cache-Control": "no-store" },
  });
}
