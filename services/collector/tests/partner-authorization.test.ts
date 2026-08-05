import assert from "node:assert/strict";
import test from "node:test";

import { loadConfig } from "../src/config.js";
import {
  assertSourceScanAuthorized,
  PartnerSourceAuthorizationError,
  PublicWebPolicyError,
} from "../src/crawler.js";
import type { PartnerRetailSource } from "../src/types.js";

const PARTNER_URLS: Record<PartnerRetailSource, string> = {
  castorama: "https://www.castorama.fr/produit-test/12345678_CAFR.prd",
  conforama: "https://www.conforama.fr/produit-test/p/A123456",
  rueducommerce: "https://www.rueducommerce.fr/p/r123456.html",
};

const PUBLIC_WEB_URLS = [
  "https://www.fnac.com/a12345678/produit-test",
  "https://www.fnac.com/index/p/",
  "https://www.carrefour.fr/p/produit-test-3560071234567",
  "https://www.carrefour.fr/edito/plan-du-site",
  "https://www.jdsports.fr/c/accessoires/",
  "https://www.jdsports.fr/product/produit-test/19735246_jdsportsfr/",
  "https://www.leroymerlin.fr/produits/produit-test-12345678.html",
  "https://www.leroymerlin.fr/plan-de-site-produits.html",
] as const;

test("la configuration partenaire est vide par défaut et valide une liste explicite", () => {
  assert.deepEqual(loadConfig({}).authorizedPartnerSources, []);
  assert.deepEqual(loadConfig({
    AUTHORIZED_PARTNER_SOURCES: "CASTORAMA, conforama,castorama, rueducommerce",
  }).authorizedPartnerSources, ["castorama", "conforama", "rueducommerce"]);
});

test("la configuration refuse les jokers, les sources directes et les identifiants inconnus", () => {
  for (const value of ["*", "all", "darty", "fnac", "carrefour", "jd_sports", "leroy_merlin", "castorama,source_inconnue"]) {
    assert.throws(
      () => loadConfig({ AUTHORIZED_PARTNER_SOURCES: value }),
      /AUTHORIZED_PARTNER_SOURCES contient une source invalide/u,
    );
  }
});

test("les trois sources restreintes sont bloquées avant un scan live par défaut", () => {
  for (const [source, url] of Object.entries(PARTNER_URLS)) {
    assert.throws(
      () => assertSourceScanAuthorized(url),
      (error: unknown) => error instanceof PartnerSourceAuthorizationError && error.source === source,
    );
  }
});

test("une autorisation n'ouvre que la source restreinte nommée", () => {
  assert.doesNotThrow(() => assertSourceScanAuthorized(PARTNER_URLS.castorama, {
    authorizedPartnerSources: ["castorama"],
  }));
  assert.throws(
    () => assertSourceScanAuthorized(PARTNER_URLS.conforama, {
      authorizedPartnerSources: ["castorama"],
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

test("les voies web publiques approuvées fonctionnent sans partenariat", () => {
  for (const url of PUBLIC_WEB_URLS) {
    assert.doesNotThrow(() => assertSourceScanAuthorized(url));
  }
});

test("les voies publiques refusent les parcours privés, le panier et les proxys", () => {
  for (const url of [
    "https://www.fnac.com/account/login",
    "https://www.carrefour.fr/set-store/123",
    "https://www.jdsports.fr/cart/",
    "https://www.leroymerlin.fr/recherche?q=perceuse",
  ]) {
    assert.throws(() => assertSourceScanAuthorized(url), PublicWebPolicyError);
  }
  assert.throws(
    () => assertSourceScanAuthorized(PUBLIC_WEB_URLS[0], { shadowCart: true }),
    PublicWebPolicyError,
  );
  assert.throws(
    () => assertSourceScanAuthorized(PUBLIC_WEB_URLS[2], { proxyUrls: ["https://proxy.example"] }),
    PublicWebPolicyError,
  );
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
