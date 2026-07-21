import { sql } from "drizzle-orm";
import {
  check,
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

export const alerts = sqliteTable(
  "alerts",
  {
    id: text("id").primaryKey(),
    source: text("source").notNull(),
    sourceMode: text("source_mode").notNull(),
    merchant: text("merchant").notNull(),
    market: text("market").notNull(),
    productId: text("product_id").notNull(),
    title: text("title").notNull(),
    url: text("url").notNull(),
    currency: text("currency").notNull(),
    priceCents: integer("price_cents").notNull(),
    usualPriceCents: integer("usual_price_cents").notNull(),
    discountPercent: integer("discount_percent").notNull(),
    score: integer("score").notNull(),
    confidence: text("confidence").notNull(),
    status: text("status").notNull(),
    seller: text("seller"),
    condition: text("condition"),
    shippingCents: integer("shipping_cents"),
    evidenceJson: text("evidence_json").notNull().default("{}"),
    observedAt: text("observed_at").notNull(),
    verifiedAt: text("verified_at"),
    expiresAt: text("expires_at"),
    createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
    updatedAt: text("updated_at").notNull().default(sql`CURRENT_TIMESTAMP`),
  },
  (table) => [
    index("alerts_status_score_observed_idx").on(
      table.status,
      table.score,
      table.observedAt
    ),
    index("alerts_source_market_product_idx").on(
      table.source,
      table.market,
      table.productId
    ),
    index("alerts_expiry_updated_idx").on(table.expiresAt, table.updatedAt),
    check("alerts_price_nonnegative", sql`${table.priceCents} >= 0`),
    check("alerts_usual_price_positive", sql`${table.usualPriceCents} > 0`),
    check(
      "alerts_source_allowed",
      sql`${table.source} IN ('amazon', 'boulanger', 'cdiscount', 'darty')`
    ),
    check(
      "alerts_source_mode_allowed",
      sql`${table.sourceMode} IN ('live', 'demo', 'fixture')`
    ),
    check(
      "alerts_confidence_allowed",
      sql`${table.confidence} IN ('very_likely', 'likely', 'review', 'insufficient')`
    ),
    check(
      "alerts_status_allowed",
      sql`${table.status} IN ('active', 'review', 'monitoring', 'expired')`
    ),
    check(
      "alerts_shipping_nonnegative",
      sql`${table.shippingCents} >= 0`
    ),
    check(
      "alerts_discount_percent_range",
      sql`${table.discountPercent} BETWEEN 0 AND 100`
    ),
    check("alerts_score_range", sql`${table.score} BETWEEN 0 AND 100`),
  ]
);

export const priceObservations = sqliteTable(
  "price_observations",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    alertId: text("alert_id")
      .notNull()
      .references(() => alerts.id, { onDelete: "cascade" }),
    priceCents: integer("price_cents").notNull(),
    shippingCents: integer("shipping_cents"),
    totalCents: integer("total_cents"),
    available: integer("available", { mode: "boolean" })
      .notNull()
      .default(true),
    observedAt: text("observed_at").notNull(),
    rawHash: text("raw_hash").notNull(),
  },
  (table) => [
    uniqueIndex("observations_alert_raw_hash_unique").on(
      table.alertId,
      table.rawHash
    ),
    index("observations_alert_observed_idx").on(
      table.alertId,
      table.observedAt
    ),
    index("observations_observed_idx").on(table.observedAt),
    check("observations_price_nonnegative", sql`${table.priceCents} >= 0`),
    check(
      "observations_shipping_nonnegative",
      sql`${table.shippingCents} >= 0`
    ),
    check("observations_total_nonnegative", sql`${table.totalCents} >= 0`),
    check(
      "observations_total_consistent",
      sql`(${table.shippingCents} IS NULL AND ${table.totalCents} IS NULL) OR (${table.shippingCents} IS NOT NULL AND ${table.totalCents} = ${table.priceCents} + ${table.shippingCents})`
    ),
  ]
);

export const sourceStatuses = sqliteTable(
  "source_statuses",
  {
    id: text("id").primaryKey(),
    source: text("source").notNull(),
    market: text("market").notNull(),
    displayName: text("display_name").notNull(),
    mode: text("mode").notNull(),
    status: text("status").notNull(),
    lastSuccessAt: text("last_success_at"),
    lastAttemptAt: text("last_attempt_at"),
    lastErrorCode: text("last_error_code"),
    productsSeen: integer("products_seen").notNull().default(0),
    queueLag: integer("queue_lag").notNull().default(0),
    updatedAt: text("updated_at").notNull().default(sql`CURRENT_TIMESTAMP`),
  },
  (table) => [
    uniqueIndex("source_statuses_source_market_unique").on(
      table.source,
      table.market
    ),
    index("source_statuses_status_updated_idx").on(
      table.status,
      table.updatedAt
    ),
    check(
      "source_statuses_products_seen_nonnegative",
      sql`${table.productsSeen} >= 0`
    ),
    check("source_statuses_queue_lag_nonnegative", sql`${table.queueLag} >= 0`),
    check(
      "source_statuses_mode_allowed",
      sql`${table.mode} IN ('live', 'demo', 'fixture')`
    ),
    check(
      "source_statuses_status_allowed",
      sql`${table.status} IN ('healthy', 'degraded', 'offline', 'not_configured')`
    ),
  ]
);

export const ingestEvents = sqliteTable(
  "ingest_events",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    idempotencyKey: text("idempotency_key").notNull(),
    source: text("source").notNull(),
    eventType: text("event_type").notNull(),
    payloadHash: text("payload_hash").notNull(),
    accepted: integer("accepted", { mode: "boolean" }).notNull().default(true),
    createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
  },
  (table) => [
    uniqueIndex("ingest_events_idempotency_key_unique").on(
      table.idempotencyKey
    ),
    index("ingest_events_source_created_idx").on(table.source, table.createdAt),
    index("ingest_events_created_idx").on(table.createdAt),
    check(
      "ingest_events_type_allowed",
      sql`${table.eventType} IN ('alert_upsert', 'source_status')`
    ),
  ]
);

export const pushSubscriptions = sqliteTable(
  "push_subscriptions",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    ownerId: text("owner_id").notNull(),
    endpoint: text("endpoint").notNull(),
    p256dh: text("p256dh").notNull(),
    auth: text("auth").notNull(),
    contentEncoding: text("content_encoding").notNull().default("aes128gcm"),
    enabled: integer("enabled", { mode: "boolean" }).notNull().default(true),
    createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
    updatedAt: text("updated_at").notNull().default(sql`CURRENT_TIMESTAMP`),
  },
  (table) => [
    uniqueIndex("push_subscriptions_owner_endpoint_unique").on(
      table.ownerId,
      table.endpoint
    ),
    index("push_subscriptions_enabled_owner_idx").on(
      table.enabled,
      table.ownerId
    ),
    index("push_subscriptions_enabled_updated_idx").on(
      table.enabled,
      table.updatedAt
    ),
    check(
      "push_subscriptions_encoding_allowed",
      sql`${table.contentEncoding} IN ('aes128gcm', 'aesgcm')`
    ),
  ]
);

export const userPreferences = sqliteTable(
  "user_preferences",
  {
    ownerId: text("owner_id").primaryKey(),
    minScore: integer("min_score").notNull().default(75),
    quietHours: integer("quiet_hours", { mode: "boolean" })
      .notNull()
      .default(false),
    quietStart: text("quiet_start").notNull().default("22:00"),
    quietEnd: text("quiet_end").notNull().default("08:00"),
    timezone: text("timezone").notNull().default("Europe/Paris"),
    notificationEnabled: integer("notification_enabled", { mode: "boolean" })
      .notNull()
      .default(true),
    createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
    updatedAt: text("updated_at").notNull().default(sql`CURRENT_TIMESTAMP`),
  },
  (table) => [
    check(
      "user_preferences_min_score_range",
      sql`${table.minScore} BETWEEN 60 AND 95`
    ),
  ]
);

export const notificationDeliveries = sqliteTable(
  "notification_deliveries",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    alertId: text("alert_id").notNull(),
    subscriptionId: integer("subscription_id")
      .notNull()
      .references(() => pushSubscriptions.id, { onDelete: "cascade" }),
    ownerId: text("owner_id").notNull(),
    channel: text("channel").notNull(),
    status: text("status").notNull(),
    dedupeKey: text("dedupe_key").notNull(),
    attemptedAt: text("attempted_at").notNull().default(sql`CURRENT_TIMESTAMP`),
    sentAt: text("sent_at"),
    errorCode: text("error_code"),
  },
  (table) => [
    uniqueIndex("notification_deliveries_dedupe_key_unique").on(
      table.dedupeKey
    ),
    index("notification_deliveries_owner_alert_idx").on(
      table.ownerId,
      table.alertId
    ),
    index("notification_deliveries_attempted_idx").on(table.attemptedAt),
    check(
      "notification_deliveries_channel_allowed",
      sql`${table.channel} IN ('web_push')`
    ),
    check(
      "notification_deliveries_status_allowed",
      sql`${table.status} IN ('reserved', 'sent', 'failed', 'suppressed')`
    ),
  ]
);

export const keepaCache = sqliteTable(
  "keepa_cache",
  {
    id: text("id").primaryKey(),
    market: text("market").notNull(),
    asin: text("asin").notNull(),
    responseJson: text("response_json").notNull(),
    fetchedAt: text("fetched_at").notNull(),
    expiresAt: text("expires_at").notNull(),
  },
  (table) => [
    uniqueIndex("keepa_cache_market_asin_unique").on(table.market, table.asin),
    index("keepa_cache_expires_idx").on(table.expiresAt),
  ]
);

export const keepaUsage = sqliteTable(
  "keepa_usage",
  {
    id: text("id").primaryKey(),
    ownerId: text("owner_id").notNull(),
    windowStart: text("window_start").notNull(),
    requests: integer("requests").notNull().default(0),
    updatedAt: text("updated_at").notNull().default(sql`CURRENT_TIMESTAMP`),
  },
  (table) => [
    uniqueIndex("keepa_usage_owner_window_unique").on(
      table.ownerId,
      table.windowStart
    ),
    index("keepa_usage_window_idx").on(table.windowStart),
    check("keepa_usage_requests_nonnegative", sql`${table.requests} >= 0`),
  ]
);
