import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import test from "node:test";
import vm from "node:vm";

async function bridgeContext(overrides = {}) {
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
    ...overrides,
  };
  vm.createContext(context);
  vm.runInContext(source, context, { filename: "Code.gs" });
  return context;
}

function gmailMessage({ id, groupId, postId, subject, date = new Date() }) {
  return {
    getId: () => id,
    getFrom: () => "Facebook <notification@facebookmail.com>",
    getDate: () => date,
    getSubject: () => subject,
    getPlainBody: () => "Une nouvelle offre vient d’être publiée.",
    getBody: () => `<a href="https://www.facebook.com/groups/${groupId}/posts/${postId}/">Ouvrir</a>`,
  };
}

function gmailThread(messages) {
  return {
    labels: [],
    getMessages: () => messages,
    addLabel(label) { this.labels.push(label.name); },
  };
}

async function relayHarness(threads, fetchImpl) {
  const properties = new Map([
    ["PRIXRADAR_BASE_URL", "https://prixradar.example"],
    ["PRIXRADAR_INGEST_SECRET", "x".repeat(32)],
  ]);
  const labels = new Map();
  const searchStarts = [];
  const lock = { released: false };
  const context = await bridgeContext({
    LockService: {
      getScriptLock: () => ({
        tryLock: () => true,
        releaseLock: () => { lock.released = true; },
      }),
    },
    PropertiesService: {
      getScriptProperties: () => ({
        getProperty: (name) => properties.get(name) ?? null,
        setProperty: (name, value) => { properties.set(name, value); },
      }),
    },
    GmailApp: {
      search(_query, start, maximum) {
        searchStarts.push(start);
        return threads.slice(start, start + maximum);
      },
      getUserLabelByName: (name) => labels.get(name) ?? null,
      createLabel(name) {
        const label = { name };
        labels.set(name, label);
        return label;
      },
    },
    UrlFetchApp: { fetch: fetchImpl },
  });
  return { context, lock, properties, searchStarts };
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

test("le relais conserve un e-mail retardé sans lien canonique malgré accents et ponctuation", async () => {
  const context = await bridgeContext();
  const parsed = context.parseFacebookEmailContent_(
    "Lucie a publié dans Bons plans courses et réductions · Mélina",
    "Nouvelle publication à découvrir dans le groupe",
    '<a href="https://www.facebook.com/n/?notif_t=group_activity">Voir la publication</a>',
    new Date("2026-08-11T04:30:00.000Z"),
  );
  assert.equal(parsed.sourceId, "facebook:584379244259839");
  assert.match(parsed.externalId, /^mail-[a-f0-9]{8}$/u);
  assert.equal(parsed.publicationUrl, "https://www.facebook.com/groups/584379244259839/");
});

test("le relais refuse commentaires et réactions même avec un lien de publication", async () => {
  const context = await bridgeContext();
  for (const subject of [
    "Jean a commenté votre publication dans Bons plans courses et réductions · Mélina",
    "Lucie a réagi à votre publication dans SARAH - Les Addicts Des Bons Plans",
    "Paul a publié un commentaire dans SARAH - Les Addicts Des Bons Plans",
    "Paul replied to a post in SARAH - Les Addicts Des Bons Plans",
  ]) {
    const parsed = context.parseFacebookEmailContent_(
      subject,
      "Une personne a interagi avec le post.",
      '<a href="https://www.facebook.com/groups/584379244259839/posts/123456789/">Voir</a>',
      new Date("2026-08-11T08:00:00.000Z"),
    );
    assert.equal(parsed, null, subject);
  }
});

test("Apps Script pagine toutes les conversations Facebook", async () => {
  const threads = Array.from({ length: 101 }, (_value, index) => gmailThread([{
    getId: () => `ignored-${index}`,
    getFrom: () => "Facebook <notification@facebookmail.com>",
    getDate: () => new Date(),
    getSubject: () => "Rappel de sécurité Facebook",
    getPlainBody: () => "Aucune publication de groupe.",
    getBody: () => "",
  }]));
  const harness = await relayHarness(threads, () => { throw new Error("unexpected fetch"); });
  const result = harness.context.relayFacebookEmailsNow();
  assert.equal(result.scannedThreads, 101);
  assert.deepEqual(harness.searchStarts, [0, 100]);
  assert.equal(harness.lock.released, true);
});

test("Apps Script ingère sans perte plus de 40 publications puis checkpoint chaque lot", async () => {
  const messages = Array.from({ length: 41 }, (_value, index) => gmailMessage({
    id: `message-${index}`,
    groupId: "848306336465354",
    postId: String(100000000 + index),
    subject: `Auteur ${index} a publié dans SARAH - Les Addicts Des Bons Plans`,
  }));
  const batches = [];
  const harness = await relayHarness([gmailThread(messages)], (_url, options) => {
    const payload = JSON.parse(options.payload);
    batches.push(payload.items.map((item) => item.externalId));
    return {
      getResponseCode: () => 202,
      getContentText: () => JSON.stringify({
        ok: true,
        accepted: payload.items.length,
        newItems: payload.items,
        notificationDispatch: { requested: true, started: true },
      }),
    };
  });
  const result = harness.context.relayFacebookEmailsNow();
  assert.equal(result.accepted, 41);
  assert.deepEqual(batches.map((batch) => batch.length), [40, 1]);
  const receipts = JSON.parse(harness.properties.get("PRIXRADAR_FACEBOOK_MESSAGE_IDS"));
  assert.equal(Object.keys(receipts).length, 41);
  assert.equal(harness.lock.released, true);
});

test("Apps Script conserve le checkpoint d’une source si la suivante échoue", async () => {
  const first = gmailMessage({
    id: "first-source",
    groupId: "848306336465354",
    postId: "123456781",
    subject: "Marie a publié dans SARAH - Les Addicts Des Bons Plans",
  });
  const second = gmailMessage({
    id: "second-source",
    groupId: "584379244259839",
    postId: "123456782",
    subject: "Lucie a publié dans Bons plans courses et réductions · Mélina",
  });
  let calls = 0;
  const harness = await relayHarness([gmailThread([first, second])], (_url, options) => {
    calls += 1;
    if (calls === 2) throw new Error("source unavailable");
    const payload = JSON.parse(options.payload);
    return {
      getResponseCode: () => 202,
      getContentText: () => JSON.stringify({
        ok: true,
        accepted: payload.items.length,
        newItems: payload.items,
        notificationDispatch: { requested: true, started: true },
      }),
    };
  });
  assert.throws(() => harness.context.relayFacebookEmailsNow(), /source unavailable/u);
  const receipts = JSON.parse(harness.properties.get("PRIXRADAR_FACEBOOK_MESSAGE_IDS"));
  assert.equal(Boolean(receipts["first-source"]), true);
  assert.equal(Boolean(receipts["second-source"]), false);
  assert.equal(harness.lock.released, true);
});

test("Apps Script déduplique les messages, pas les conversations Gmail", async () => {
  const source = await readFile(new URL("../integrations/facebook-gmail-bridge/Code.gs", import.meta.url), "utf8");
  assert.match(source, /message\.getId\(\)/u);
  assert.match(source, /PRIXRADAR_FACEBOOK_MESSAGE_IDS/u);
  assert.doesNotMatch(source, /newer_than:2d -label/u);
  assert.match(source, /PRIXRADAR_MAX_MESSAGE_AGE_MINUTES = 6 \* 60/u);
  assert.match(source, /LockService\.getScriptLock\(\)/u);
  assert.match(source, /GmailApp\.search\(query, searchStart, PRIXRADAR_SEARCH_PAGE_SIZE\)/u);
});

test("le manifeste utilise le fuseau Paris et laisse Apps Script déduire les droits nécessaires", async () => {
  const manifest = JSON.parse(await readFile(new URL("../integrations/facebook-gmail-bridge/appsscript.json", import.meta.url), "utf8"));
  assert.equal(manifest.timeZone, "Europe/Paris");
  assert.equal(manifest.runtimeVersion, "V8");
  assert.equal("oauthScopes" in manifest, false);
});
