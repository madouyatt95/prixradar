import { runtimeEnv as env } from "@/lib/runtime-env";

async function digest(value: string) {
  const bytes = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return [...new Uint8Array(bytes)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

async function secretsEqual(received: string, expected: string) {
  const [left, right] = await Promise.all([digest(received), digest(expected)]);
  let difference = left.length ^ right.length;
  for (let index = 0; index < Math.max(left.length, right.length); index += 1) {
    difference |= (left.charCodeAt(index) || 0) ^ (right.charCodeAt(index) || 0);
  }
  return difference === 0;
}

export async function authenticateSocialCollector(request: Request) {
  const workerSecret = (env as unknown as { INGEST_SECRET?: unknown }).INGEST_SECRET;
  const relaySecret = (env as unknown as { FACEBOOK_RELAY_SECRET?: unknown }).FACEBOOK_RELAY_SECRET;
  const expected = [
    typeof workerSecret === "string" ? workerSecret : process.env.INGEST_SECRET,
    typeof relaySecret === "string" ? relaySecret : process.env.FACEBOOK_RELAY_SECRET,
  ].filter((value): value is string => typeof value === "string" && value.length >= 24);
  if (expected.length === 0) return false;
  const match = /^Bearer ([^\s]{1,512})$/u.exec(request.headers.get("authorization") ?? "");
  return Boolean(match && (await Promise.all(expected.map((secret) => secretsEqual(match[1], secret)))).some(Boolean));
}

export function socialMonthlyBudgetMicros() {
  const binding = (env as unknown as { SOCIAL_MONTHLY_BUDGET_CENTS?: unknown }).SOCIAL_MONTHLY_BUDGET_CENTS;
  const raw = typeof binding === "string" ? binding : process.env.SOCIAL_MONTHLY_BUDGET_CENTS;
  const cents = typeof raw === "string" && /^\d{1,6}$/u.test(raw) ? Number(raw) : 2_900;
  return Math.max(100, Math.min(100_000, cents)) * 10_000;
}

export function currentMonthStart(now = new Date()) {
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1)).toISOString();
}
