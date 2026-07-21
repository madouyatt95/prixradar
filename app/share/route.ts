import { NextResponse } from "next/server";

import { parseMerchantUrl } from "@/lib/merchant-url";

export function GET(request: Request) {
  const incoming = new URL(request.url);
  const raw = incoming.searchParams.get("url") ?? incoming.searchParams.get("text") ?? "";
  const merchant = parseMerchantUrl(raw.trim());
  const destination = new URL("/", incoming.origin);
  destination.searchParams.set("view", "radar");
  if (merchant) destination.searchParams.set("inspect", merchant.url);
  else destination.searchParams.set("inspectError", "unsupported");
  return NextResponse.redirect(destination, 303);
}
