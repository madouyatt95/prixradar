import assert from "node:assert/strict";
import test from "node:test";

import { loadConfig } from "../src/config.js";
import {
  assertSourceScanAuthorized,
  PartnerSourceAuthorizationError,
} from "../src/crawler.js";
import type { PartnerRetailSource } from "../src/types.js";

const PARTNER_URLS: Record<PartnerRetailSource, string> = {
  fnac: "https://www.fnac.com/a12345678/produit-test",
  carrefour: "https://www.carrefour.fr/p/produit-test-3560071234567",
  leroy_merlin: "https://www.leroymerlin.fr/produits/produit-test-12345678.html",
  castorama: "https://www.castorama.fr/produit-test/12345678_CAFR.prd",
  conforama: "https://www.conforama.fr/produit-test/p/A123456",
  rueducommerce: "https://www.rueducommerce.fr/p/r123456.html",
};

test("la configuration partenaire est vide par défaut et valide une liste explicite", () => {
  assert.deepEqual(loadConfig({}).authorizedPartnerSources, []);
  assert.deepEqual(loadConfig({
    AUTHORIZED_PARTNER_SOURCES: "FNAC, carrefour,fnac, leroy_merlin",
  }).authorizedPartnerSources, ["fnac", "carrefour", "leroy_merlin"]);
});

test("la configuration refuse les jokers, les sources directes et les identifiants inconnus", () => {
  for (const value of ["*", "all", "darty", "fnac,source_inconnue"]) {
    assert.throws(
      () => loadConfig({ AUTHORIZED_PARTNER_SOURCES: value }),
      /AUTHORIZED_PARTNER_SOURCES contient une source invalide/u,
    );
  }
});

test("toutes les sources partenaires sont bloquées avant un scan live par défaut", () => {
  for (const [source, url] of Object.entries(PARTNER_URLS)) {
    assert.throws(
      () => assertSourceScanAuthorized(url),
      (error: unknown) => error instanceof PartnerSourceAuthorizationError && error.source === source,
    );
  }
});

test("une autorisation n'ouvre que la source partenaire nommée", () => {
  assert.doesNotThrow(() => assertSourceScanAuthorized(PARTNER_URLS.fnac, {
    authorizedPartnerSources: ["fnac"],
  }));
  assert.throws(
    () => assertSourceScanAuthorized(PARTNER_URLS.carrefour, {
      authorizedPartnerSources: ["fnac"],
    }),
    PartnerSourceAuthorizationError,
  );
});

test("le drapeau fixture ne contourne jamais l’autorisation réseau partenaire", () => {
  for (const url of Object.values(PARTNER_URLS)) {
    assert.throws(
      () => assertSourceScanAuthorized(url, { fixture: true }),
      PartnerSourceAuthorizationError,
    );
  }
});

test("les sources directes restent utilisables sans autorisation partenaire", () => {
  for (const url of [
    "https://www.boulanger.com/ref/123456",
    "https://www.darty.com/nav/achat/produit-test.html",
    "https://www.cdiscount.com/pdt/test.html",
    "https://www.amazon.fr/dp/B012345678",
  ]) {
    assert.doesNotThrow(() => assertSourceScanAuthorized(url));
  }
});
