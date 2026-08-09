import assert from "node:assert/strict";
import test from "node:test";

import {
  actorRunCostUsd,
  FACEBOOK_SOCIAL_SOURCES,
  normalizeOfficialFacebookPost,
  parseFacebookArticle,
} from "../src/social.js";

test("calcule le coût réel des événements facturés par l’Actor officiel", () => {
  assert.equal(actorRunCostUsd({
    usageTotalUsd: 0.001,
    chargedEventCounts: {
      "actor-start": 1,
      "date-filter": 2,
    },
    pricingInfo: {
      pricingModel: "PAY_PER_EVENT",
      pricingPerEvent: {
        actorChargeEvents: {
          "actor-start": { eventPriceUsd: 0.001 },
          "date-filter": { eventPriceUsd: 0.007 },
        },
      },
    },
  }), 0.015);
});

test("conserve le coût d’usage quand aucun tarif par événement n’est fourni", () => {
  assert.equal(actorRunCostUsd({ usageTotalUsd: 0.001 }), 0.001);
});

test("extrait un post Facebook public avec son lien marchand et son heure", () => {
  const source = FACEBOOK_SOCIAL_SOURCES[0];
  assert.ok(source);
  const item = parseFacebookArticle({
    text: "Sarah Bons Plans\n1 min ·\nERREUR DE PRIX sur les écouteurs, foncez vite !\nJ’aime\nCommenter\nPartager",
    hrefs: [
      `https://www.facebook.com/groups/${source.groupId}/posts/123456789012345/`,
      "https://l.facebook.com/l.php?u=https%3A%2F%2Famzlink.to%2Faz0AbCd",
    ],
    imageUrl: "https://scontent-cdg4-3.xx.fbcdn.net/example.jpg",
    dateTime: null,
    timeLabels: ["1 min"],
  }, source, new Date("2026-08-09T18:00:00.000Z"));
  assert.ok(item);
  assert.equal(item.externalId, "123456789012345");
  assert.equal(item.author, "Sarah Bons Plans");
  assert.match(item.text, /ERREUR DE PRIX/u);
  assert.equal(item.externalUrl, "https://amzlink.to/az0AbCd");
  assert.equal(item.publishedAt, "2026-08-09T17:59:00.000Z");
});

test("refuse un article qui ne prouve pas son identifiant de publication", () => {
  const source = FACEBOOK_SOCIAL_SOURCES[1];
  assert.ok(source);
  assert.equal(parseFacebookArticle({
    text: "Une publication sans permalien",
    hrefs: [source.url],
    imageUrl: null,
    dateTime: null,
    timeLabels: [],
  }, source), null);
});

test("normalise une publication de l’Actor Facebook officiel", () => {
  const source = FACEBOOK_SOCIAL_SOURCES[0];
  assert.ok(source);
  const item = normalizeOfficialFacebookPost({
    facebookUrl: source.url,
    url: `https://www.facebook.com/groups/${source.groupId}/posts/998877665544332/`,
    legacyId: "998877665544332",
    time: "2026-08-09T18:03:12.000Z",
    text: "Nouveau bon plan https://example.com/offre",
    user: { name: "Sarah Bons Plans" },
    link: "https://example.com/offre",
    attachments: [{ photo: { uri: "https://scontent-cdg4-3.xx.fbcdn.net/post.jpg" } }],
  }, [source]);
  assert.ok(item);
  assert.equal(item.sourceId, source.id);
  assert.equal(item.publication.externalId, "998877665544332");
  assert.equal(item.publication.author, "Sarah Bons Plans");
  assert.equal(item.publication.externalUrl, "https://example.com/offre");
  assert.equal(item.publication.imageUrl, "https://scontent-cdg4-3.xx.fbcdn.net/post.jpg");
});
