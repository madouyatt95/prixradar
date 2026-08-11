import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import test from "node:test";
import vm from "node:vm";

async function bridgeContext() {
  const source = await readFile(new URL("../integrations/facebook-gmail-bridge/Code.gs", import.meta.url), "utf8");
  const context = {
    URL,
    Date,
    Object,
    JSON,
    String,
    Number,
    RegExp,
    Utilities: {
      DigestAlgorithm: { SHA_256: "sha256" },
      Charset: { UTF_8: "utf8" },
      computeDigest(_algorithm, value) {
        return [...createHash("sha256").update(value, "utf8").digest()].map((byte) => byte > 127 ? byte - 256 : byte);
      },
      formatDate() { return "0800"; },
    },
  };
  vm.createContext(context);
  vm.runInContext(source, context, { filename: "Code.gs" });
  return context;
}

test("le relais extrait un nouveau post d’un groupe explicitement autorisé", async () => {
  const context = await bridgeContext();
  const parsed = context.parseFacebookEmailContent_(
    "Marie a publié dans SARAH - Les Addicts Des Bons Plans",
    "Une baisse très intéressante aujourd’hui\nVoir sur Facebook",
    '<a href="https%3A%2F%2Fwww.facebook.com%2Fgroups%2F848306336465354%2Fposts%2F123456789012345%2F">Ouvrir</a>',
    new Date("2026-08-11T08:00:00.000Z"),
  );
  assert.equal(parsed.sourceId, "facebook:848306336465354");
  assert.equal(parsed.externalId, "123456789012345");
  assert.equal(parsed.author, "Marie");
  assert.equal(parsed.publicationUrl, "https://www.facebook.com/groups/848306336465354/posts/123456789012345/");
  assert.match(parsed.text, /baisse très intéressante/u);
});

test("le relais refuse un groupe non autorisé et les faux expéditeurs", async () => {
  const context = await bridgeContext();
  const parsed = context.parseFacebookEmailContent_(
    "Publication Facebook",
    "Offre inconnue",
    "https://www.facebook.com/groups/999999999999999/posts/123456789/",
    new Date("2026-08-11T08:00:00.000Z"),
  );
  assert.equal(parsed, null);
  assert.equal(context.isFacebookSender_("Facebook <notification@facebookmail.com>"), true);
  assert.equal(context.isFacebookSender_("pirate@facebookmail.com.example.org"), false);
});

test("le manifeste limite les droits à Gmail, aux appels HTTPS et au déclencheur", async () => {
  const manifest = JSON.parse(await readFile(new URL("../integrations/facebook-gmail-bridge/appsscript.json", import.meta.url), "utf8"));
  assert.deepEqual(manifest.oauthScopes.sort(), [
    "https://www.googleapis.com/auth/gmail.modify",
    "https://www.googleapis.com/auth/script.external_request",
    "https://www.googleapis.com/auth/script.scriptapp",
  ]);
  assert.equal(manifest.timeZone, "Europe/Paris");
});
