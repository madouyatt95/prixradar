import { runtimeEnv as env } from "@/lib/runtime-env";

export function readServerEnv(
  name:
    | "DEVICE_COOKIE_SECRET"
    | "INGEST_SECRET"
    | "PUSH_DELIVERY_SECRET"
    | "VAPID_PUBLIC_KEY"
): string | null {
  const workerValue = (env as unknown as Record<string, unknown>)[name];
  if (typeof workerValue === "string" && workerValue.trim()) {
    return workerValue.trim();
  }

  const nodeValue = process.env[name];
  return typeof nodeValue === "string" && nodeValue.trim()
    ? nodeValue.trim()
    : null;
}

export function vapidPublicKey(): string | null {
  const value = readServerEnv("VAPID_PUBLIC_KEY");
  return value && /^[A-Za-z0-9_-]{43,256}$/.test(value) ? value : null;
}
