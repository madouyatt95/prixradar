import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import { readFile } from "node:fs/promises";
import test from "node:test";

import { canonicalMerchantProductUrl } from "../lib/merchant-link.ts";

const productPath = "/product/marron-converse-bottes-chuck-taylor-all-star-elements-femme/19725351_jdsportsfr";

test("canonise tous les liens produit JD Sports vers l’hôte qui répond", () => {
  for (const host of ["jdsports.fr", "m.jdsports.fr", "www.jdsports.fr"]) {
    const expected = `https://www.jdsports.fr${productPath}/`;
    assert.equal(canonicalMerchantProductUrl("jd_sports", `https://${host}${productPath}`), expected);
  }
});

test("répare les liens déjà enregistrés et ceux exposés par l’API", async () => {
  const [migration, alertsRoute, collector] = await Promise.all([
    readFile(new URL("../drizzle/0024_fix_jd_sports_product_urls.sql", import.meta.url), "utf8"),
    readFile(new URL("../app/api/alerts/route.ts", import.meta.url), "utf8"),
    readFile(new URL("../services/collector/src/normalize.ts", import.meta.url), "utf8"),
  ]);
  for (const table of ["alerts", "merchant_products", "watchlist_items", "inspection_requests", "purchases", "recheck_requests"]) {
    assert.match(migration, new RegExp("UPDATE `" + table + "`", "u"));
  }
  assert.match(alertsRoute, /canonicalMerchantProductUrl\(row\.source, row\.url\)/u);
  assert.match(await readFile(new URL("../lib/merchant-url.ts", import.meta.url), "utf8"), /canonicalMerchantProductUrl\(merchant\.source, parsed\.toString\(\)\)/u);
  assert.match(collector, /jdSportsHost \? "www\.jdsports\.fr" : host/u);
});

test("la migration réécrit tous les anciens liens JD Sports", async () => {
  const migration = await readFile(new URL("../drizzle/0024_fix_jd_sports_product_urls.sql", import.meta.url), "utf8");
  const database = new DatabaseSync(":memory:");
  try {
    for (const table of ["alerts", "merchant_products", "watchlist_items", "inspection_requests", "purchases", "recheck_requests"]) {
      database.exec(`CREATE TABLE ${table} (source TEXT NOT NULL, url TEXT NOT NULL);`);
      database.prepare(`INSERT INTO ${table}(source,url) VALUES(?,?)`).run(
        "jd_sports",
        `https://m.jdsports.fr${productPath}`,
      );
    }
    database.exec(migration.replaceAll("--> statement-breakpoint", ""));
    for (const table of ["alerts", "merchant_products", "watchlist_items", "inspection_requests", "purchases", "recheck_requests"]) {
      assert.equal(
        database.prepare(`SELECT url FROM ${table}`).get().url,
        `https://www.jdsports.fr${productPath}/`,
        table,
      );
    }
  } finally {
    database.close();
  }
});
