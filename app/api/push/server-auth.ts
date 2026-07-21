import { readServerEnv } from "./server-env";

export function serverJson(body: unknown, status = 200) {
  return Response.json(body, {
    status,
    headers: { "Cache-Control": "no-store" },
  });
}

async function secretMatches(received: string, expected: string) {
  const encoder = new TextEncoder();
  const [receivedHash, expectedHash] = await Promise.all([
    crypto.subtle.digest("SHA-256", encoder.encode(received)),
    crypto.subtle.digest("SHA-256", encoder.encode(expected)),
  ]);
  const receivedBytes = new Uint8Array(receivedHash);
  const expectedBytes = new Uint8Array(expectedHash);
  let difference = receivedBytes.length ^ expectedBytes.length;
  for (let index = 0; index < Math.max(receivedBytes.length, expectedBytes.length); index += 1) {
    difference |= (receivedBytes[index] ?? 0) ^ (expectedBytes[index] ?? 0);
  }
  return difference === 0;
}

export async function authorizePushDelivery(request: Request) {
  const expected = readServerEnv("PUSH_DELIVERY_SECRET");
  if (expected === null || expected.length < 24) {
    return {
      ok: false as const,
      response: serverJson(
        {
          ok: false,
          code: "push_delivery_not_configured",
          error: "La distribution push serveur n’est pas configurée.",
        },
        503,
      ),
    };
  }

  const authorization = request.headers.get("authorization") ?? "";
  const received = authorization.startsWith("Bearer ")
    ? authorization.slice(7)
    : "";
  if (!(await secretMatches(received, expected))) {
    return {
      ok: false as const,
      response: serverJson(
        { ok: false, code: "unauthorized", error: "Accès refusé." },
        401,
      ),
    };
  }

  return { ok: true as const };
}
