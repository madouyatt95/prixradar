import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import { readFile } from "node:fs/promises";
import test from "node:test";

import {
  isFacebookRelayWindow,
  parseFacebookEmailContent,
  trustedFacebookSender,
} from "../lib/facebook-email.ts";

test("le relais Facebook respecte 07:30-15:00 à Paris, été comme hiver", () => {
  assert.equal(isFacebookRelayWindow(new Date("2026-01-10T06:29:00Z")), false);
  assert.equal(isFacebookRelayWindow(new Date("2026-01-10T06:30:00Z")), true);
  assert.equal(isFacebookRelayWindow(new Date("2026-01-10T14:00:00Z")), true);
  assert.equal(isFacebookRelayWindow(new Date("2026-01-10T14:01:00Z")), false);
  assert.equal(isFacebookRelayWindow(new Date("2026-08-11T05:29:00Z")), false);
  assert.equal(isFacebookRelayWindow(new Date("2026-08-11T05:30:00Z")), true);
  assert.equal(isFacebookRelayWindow(new Date("2026-08-11T13:00:00Z")), true);
  assert.equal(isFacebookRelayWindow(new Date("2026-08-11T13:01:00Z")), false);
});

test("le lecteur accepte seulement Facebook et les deux groupes autorisés", () => {
  const now = new Date("2026-08-11T08:20:00.000Z");
  const accepted = parseFacebookEmailContent({
    from: "Facebook <notification@facebookmail.com>",
    subject: "Marie a publié dans SARAH - Les Addicts Des Bons Plans",
    text: "Une baisse très intéressante aujourd’hui\nVoir sur Facebook",
    html: '<a href="https%3A%2F%2Fwww.facebook.com%2Fgroups%2F848306336465354%2Fposts%2F123456789012345%2F">Ouvrir</a>',
    date: new Date("2026-08-11T08:00:00.000Z"),
  }, now);
  assert.equal(accepted?.sourceId, "facebook:848306336465354");
  assert.equal(accepted?.externalId, "123456789012345");
  assert.equal(accepted?.author, "Marie");
  assert.equal(trustedFacebookSender("pirate@facebookmail.com.example.org"), false);

  const foreignGroup = parseFacebookEmailContent({
    from: "notification@facebookmail.com",
    subject: "Publication Facebook",
    text: "Offre inconnue",
    html: "https://www.facebook.com/groups/999999999999999/posts/123456789/",
    date: new Date("2026-08-11T08:00:00.000Z"),
  }, now);
  assert.equal(foreignGroup, null);

  const stale = parseFacebookEmailContent({
    from: "notification@facebookmail.com",
    subject: "Publication Facebook",
    text: "Offre ancienne",
    html: "https://www.facebook.com/groups/848306336465354/posts/123456789/",
    date: new Date("2026-08-11T01:00:00.000Z"),
  }, now);
  assert.equal(stale, null);

  const delayedWithoutCanonicalPostLink = parseFacebookEmailContent({
    from: "notification@facebookmail.com",
    subject: "Lucie a publié dans Bons plans courses et reductions - Melina",
    text: "Nouvelle publication à découvrir dans le groupe",
    html: '<a href="https://www.facebook.com/n/?notif_t=group_activity">Voir la publication</a>',
    date: new Date("2026-08-11T04:30:00.000Z"),
  }, now);
  assert.equal(delayedWithoutCanonicalPostLink?.sourceId, "facebook:584379244259839");
  assert.match(delayedWithoutCanonicalPostLink?.externalId ?? "", /^mail-[a-f0-9]{8}$/u);
  assert.equal(delayedWithoutCanonicalPostLink?.publicationUrl, "https://www.facebook.com/groups/584379244259839/");
});

test("la déduplication Gmail bloque le retraitement du même UID", async () => {
  const database = new DatabaseSync(":memory:");
  try {
    const migration = await readFile(new URL("../drizzle/0019_facebook_gmail_imap.sql", import.meta.url), "utf8");
    database.exec(migration);
    const insert = database.prepare(`
      INSERT INTO facebook_email_receipts(mailbox,uid,status,processed_at)
      VALUES(?,?,?,?)
    `);
    insert.run("relay@gmail.com", "42", "processed", "2026-08-11T08:00:00.000Z");
    assert.throws(() => insert.run(
      "relay@gmail.com",
      "42",
      "processed",
      "2026-08-11T08:01:00.000Z",
    ), /UNIQUE constraint failed/u);
  } finally {
    database.close();
  }
});

test("Cloudflare relève Gmail chaque minute sans exposer de secret", async () => {
  const [worker, config, route, example] = await Promise.all([
    readFile(new URL("../worker/index.ts", import.meta.url), "utf8"),
    readFile(new URL("../vite.config.ts", import.meta.url), "utf8"),
    readFile(new URL("../app/api/social/ingest/route.ts", import.meta.url), "utf8"),
    readFile(new URL("../.env.example", import.meta.url), "utf8"),
  ]);
  assert.match(worker, /pollFacebookGmail/u);
  assert.match(worker, /isFacebookRelayWindow\(scheduledAt\)/u);
  assert.match(config, /crons: \["\* \* \* \* \*"\]/u);
  assert.match(route, /startSocialDispatch\(newPublications\)/u);
  assert.match(example, /FACEBOOK_GMAIL_APP_PASSWORD=\n/u);
  assert.doesNotMatch(worker, /prixradar\d+@gmail\.com/u);
  assert.doesNotMatch(worker, /FACEBOOK_GMAIL_APP_PASSWORD\s*[:=]\s*["'][^"']+/u);
});
