import { env } from "cloudflare:workers";

function serverValue(name: string) {
  const workerValue = (env as unknown as Record<string, unknown>)[name];
  if (typeof workerValue === "string" && workerValue.trim()) return workerValue.trim();
  const nodeValue = process.env[name];
  return typeof nodeValue === "string" && nodeValue.trim() ? nodeValue.trim() : null;
}

export function adminConfigured() {
  return serverValue("ADMIN_EMAILS") !== null || process.env.NODE_ENV !== "production";
}

export function adminJson(body: unknown, status = 200) {
  return Response.json(body, { status, headers: { "Cache-Control": "no-store" } });
}

export function authorizeAdmin(request: Request) {
  const rawAllowlist = serverValue("ADMIN_EMAILS");
  const received = request.headers.get("oai-authenticated-user-email")?.trim().toLowerCase() ?? "";
  if (rawAllowlist === null && process.env.NODE_ENV !== "production") {
    return { ok: true as const, email: received || "admin@local.prixradar" };
  }
  if (rawAllowlist === null) {
    return {
      ok: false as const,
      response: adminJson({ ok: false, code: "ADMIN_NOT_CONFIGURED", error: "Le centre administrateur n’est pas configuré." }, 503),
    };
  }
  const allowed = new Set(rawAllowlist.split(",").map((email) => email.trim().toLowerCase()).filter(Boolean));
  if (!received || !allowed.has(received)) {
    return {
      ok: false as const,
      response: adminJson({ ok: false, code: "ADMIN_UNAUTHORIZED", error: "Connexion administrateur requise." }, 401),
    };
  }
  return { ok: true as const, email: received };
}
