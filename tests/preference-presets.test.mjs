import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const source = await readFile(new URL("../lib/preference-presets.ts", import.meta.url), "utf8");
const interfaceSource = await readFile(new URL("../app/components/price-radar-app.tsx", import.meta.url), "utf8");

test("essential presets keep exact variants and expose progressively broader thresholds", () => {
  assert.match(source, /safe:[\s\S]*?minScore: 85/);
  assert.match(source, /balanced:[\s\S]*?minScore: 75/);
  assert.match(source, /fast:[\s\S]*?minScore: 65/);
  assert.match(source, /safe:[\s\S]*?minDiscount: 25/);
  assert.match(source, /balanced:[\s\S]*?minDiscount: 20/);
  assert.match(source, /fast:[\s\S]*?minDiscount: 15/);
  const exactVariantRequirements = source.match(/requireExactVariant: true/g) ?? [];
  assert.equal(exactVariantRequirements.length, 3);
  assert.match(source, /safe:[\s\S]*?requireCartConfirmation: true/);
  assert.match(source, /fast:[\s\S]*?requireCartConfirmation: false/);
  assert.match(interfaceSource, /setPreset=\{applyAlertPreset\}/);
  assert.match(interfaceSource, /onClick=\{\(\) => setPreset\(value\)\}/);
});
