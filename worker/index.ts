/** Cloudflare Worker entry point for PrixRadar. */
import { handleImageOptimization, DEFAULT_DEVICE_SIZES, DEFAULT_IMAGE_SIZES } from "vinext/server/image-optimization";
import handler from "vinext/server/app-router-entry";
import PostalMime from "postal-mime";
import { dealabsItemsFromEmail, storeDealabsItems, syncDealabsTrend } from "@/lib/dealabs";
import { setRuntimeEnv } from "@/lib/runtime-env";

interface Env {
  ASSETS: Fetcher;
  DB: D1Database;
  DEVICE_COOKIE_SECRET?: string;
  AUTHORIZED_PARTNER_SOURCES?: string;
  DEALABS_EMAIL_DOMAINS?: string;
  IMAGES: {
    input(stream: ReadableStream): {
      transform(options: Record<string, unknown>): {
        output(options: { format: string; quality: number }): Promise<{ response(): Response }>;
      };
    };
  };
}

function trustedDealabsSender(sender: string, configuredDomains?: string) {
  const domain = sender.split("@").at(-1)?.toLowerCase() ?? "";
  const allowed = (configuredDomains ?? "dealabs.com")
    .split(",")
    .map((value) => value.trim().toLowerCase())
    .filter(Boolean);
  return allowed.some((candidate) => domain === candidate || domain.endsWith(`.${candidate}`));
}

// Image security config. SVG sources with .svg extension auto-skip the
// optimization endpoint on the client side (served directly, no proxy).
// To route SVGs through the optimizer (with security headers), set
// dangerouslyAllowSVG: true in next.config.js and uncomment below:
// const imageConfig: ImageConfig = { dangerouslyAllowSVG: true };

const worker = {
  async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    setRuntimeEnv(env);
    const url = new URL(request.url);

    if (url.pathname === "/_vinext/image") {
      const allowedWidths = [...DEFAULT_DEVICE_SIZES, ...DEFAULT_IMAGE_SIZES];
      return handleImageOptimization(request, {
        fetchAsset: (path) => env.ASSETS.fetch(new Request(new URL(path, request.url))),
        transformImage: async (body, { width, format, quality }) => {
          const result = await env.IMAGES.input(body).transform(width > 0 ? { width } : {}).output({ format, quality });
          return result.response();
        },
      }, allowedWidths);
    }

    return handler.fetch(request, env, ctx);
  },

  async scheduled(controller: ScheduledController, env: Env): Promise<void> {
    void controller;
    setRuntimeEnv(env);
    try {
      const result = await syncDealabsTrend(env.DB, {
        authorizedPartnerSources: env.AUTHORIZED_PARTNER_SOURCES,
      });
      console.log(JSON.stringify({ event: "dealabs_sync_completed", ...result }));
    } catch (error) {
      console.error(JSON.stringify({
        event: "dealabs_sync_failed",
        error: error instanceof Error ? error.message : "unknown",
      }));
      throw error;
    }
  },

  async email(message: ForwardableEmailMessage, env: Env): Promise<void> {
    if (!trustedDealabsSender(message.from, env.DEALABS_EMAIL_DOMAINS)) {
      message.setReject("Adresse réservée aux alertes Dealabs autorisées.");
      return;
    }
    if (message.rawSize > 512 * 1024) {
      message.setReject("Message trop volumineux.");
      return;
    }
    const raw = await new Response(message.raw).arrayBuffer();
    const parsed = await PostalMime.parse(raw);
    const items = dealabsItemsFromEmail(
      parsed.subject ?? message.headers.get("subject") ?? "",
      parsed.text ?? "",
      parsed.html ?? "",
    );
    if (items.length === 0) {
      console.log(JSON.stringify({ event: "dealabs_email_ignored", reason: "no_deal_link" }));
      return;
    }
    setRuntimeEnv(env);
    const result = await storeDealabsItems(env.DB, items, {
      authorizedPartnerSources: env.AUTHORIZED_PARTNER_SOURCES,
    });
    console.log(JSON.stringify({ event: "dealabs_email_ingested", ...result }));
  },
};

export default worker;
