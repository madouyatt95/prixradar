import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const root = new URL("../extensions/prixradar-safari/", import.meta.url);

test("Safari extension uses minimal permissions and an explicit inspection flow", async () => {
  const manifest = JSON.parse(await readFile(new URL("manifest.json", root), "utf8"));
  assert.equal(manifest.manifest_version, 3);
  assert.deepEqual(manifest.permissions, ["activeTab", "storage"]);
  assert.equal(manifest.host_permissions, undefined);
  const popup = await readFile(new URL("popup.js", root), "utf8");
  assert.match(popup, /\/share/);
  assert.match(popup, /SUPPORTED_HOSTS/);
  assert.doesNotMatch(popup, /checkout|payment|commander|payer/i);
});
