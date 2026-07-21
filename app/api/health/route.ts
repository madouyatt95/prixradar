import { env } from "cloudflare:workers";

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

  try {
    const result = await env.DB.prepare("SELECT 1 AS ok").first<{ ok: number }>();
    database = result?.ok === 1;
  } catch {
    database = false;
  }

  const body = {
    ok: database,
    service: "prixradar",
    version: "0.2.0",
    checkedAt: new Date().toISOString(),
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
    },
  };

  return Response.json(body, {
    status: database ? 200 : 503,
    headers: { "Cache-Control": "no-store" },
  });
}
