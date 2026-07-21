import { sql } from "drizzle-orm";
import {
  index,
  integer,
  sqliteTable,
  text,
  uniqueIndex,
} from "drizzle-orm/sqlite-core";

export const watchlistItems = sqliteTable(
  "watchlist_items",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    ownerId: text("owner_id").notNull(),
    productId: text("product_id").notNull(),
    source: text("source").notNull(),
    title: text("title").notNull(),
    market: text("market").notNull(),
    priceCents: integer("price_cents").notNull(),
    url: text("url").notNull(),
    createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
    updatedAt: text("updated_at").notNull().default(sql`CURRENT_TIMESTAMP`),
  },
  (table) => [
    uniqueIndex("watchlist_owner_product_source_market_unique").on(
      table.ownerId,
      table.productId,
      table.source,
      table.market
    ),
    index("watchlist_owner_updated_idx").on(table.ownerId, table.updatedAt),
  ]
);
