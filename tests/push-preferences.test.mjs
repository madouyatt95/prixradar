import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import ts from "typescript";

const source = await readFile(new URL("../lib/push-preferences.ts", import.meta.url), "utf8");
const compiled = ts.transpileModule(source, {
  compilerOptions: { module: ts.ModuleKind.ES2022, target: ts.ScriptTarget.ES2022 },
}).outputText;
const matcher = await import(`data:text/javascript;base64,${Buffer.from(compiled).toString("base64")}`);

const nowMs = Date.parse("2026-07-22T12:00:00.000Z");
const preferences = {
  minScore: 75, minSellerScore: 70, requireExactVariant: true,
  requireCartConfirmation: true, maxAlertAgeMinutes: 60, minimumHistoryPoints: 5,
  minDiscount: 20, maxPriceCents: 100_000, marketsJson: '["FR"]',
  categoriesJson: '["TV"]', sourcesJson: '["darty"]', deliveryCountry: "FR",
  postalCode: "75011", deliveryMode: "home", requireLocationMatch: true,
  notificationSpeed: "balanced",
};
const alert = {
  score: 84, sellerScore: 80, historyPoints: 8, exactVariantConfirmed: true,
  cartConfirmed: true, verifiedAt: "2026-07-22T11:45:00.000Z", discountPercent: 30,
  priceCents: 70_000, publicPriceCents: 70_000, source: "darty", market: "FR",
  category: "TV", deliveryCountry: "FR", deliveryPostalPrefix: "75",
  deliveryMode: "home", locationVerified: true,
};

test("reservation matcher enforces every advanced preference from persisted data", () => {
  assert.equal(matcher.alertMatchesPushPreferences({ preferences, alert, tier: "personal", radarMatches: true, nowMs }), true);
  assert.equal(matcher.alertMatchesPushPreferences({ preferences, alert: { ...alert, historyPoints: 4 }, tier: "personal", radarMatches: true, nowMs }), false);
  assert.equal(matcher.alertMatchesPushPreferences({ preferences, alert: { ...alert, source: "amazon" }, tier: "personal", radarMatches: true, nowMs }), false);
  assert.equal(matcher.alertMatchesPushPreferences({ preferences, alert: { ...alert, deliveryPostalPrefix: "69" }, tier: "personal", radarMatches: true, nowMs }), false);
  assert.equal(matcher.alertMatchesPushPreferences({ preferences, alert, tier: "personal", radarMatches: false, nowMs }), false);
});

test("digest and personal tiers respect the selected notification speed", () => {
  assert.equal(matcher.alertMatchesPushPreferences({ preferences: { ...preferences, notificationSpeed: "digest" }, alert, tier: "personal", radarMatches: true, nowMs }), false);
  assert.equal(matcher.alertMatchesPushPreferences({ preferences: { ...preferences, notificationSpeed: "digest" }, alert, tier: "digest", radarMatches: true, nowMs }), true);
});
