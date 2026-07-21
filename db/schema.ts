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

export const canonicalProducts = sqliteTable(
  "canonical_products",
  {
    id: text("id").primaryKey(),
    gtinKey: text("gtin_key"),
    title: text("title").notNull(),
    brand: text("brand"),
    brandKey: text("brand_key"),
    model: text("model"),
    modelKey: text("model_key"),
    category: text("category"),
    reviewStatus: text("review_status").notNull().default("automatic"),
    matchConfidence: integer("match_confidence").notNull().default(0),
    createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
    updatedAt: text("updated_at").notNull().default(sql`CURRENT_TIMESTAMP`),
  },
  (table) => [
    uniqueIndex("canonical_products_gtin_unique").on(table.gtinKey),
    index("canonical_products_brand_model_idx").on(table.brandKey, table.modelKey),
    index("canonical_products_review_idx").on(table.reviewStatus, table.updatedAt),
    check(
      "canonical_products_review_allowed",
      sql`${table.reviewStatus} IN ('automatic', 'confirmed', 'needs_review')`
    ),
    check(
      "canonical_products_confidence_range",
      sql`${table.matchConfidence} BETWEEN 0 AND 100`
    ),
  ]
);

export const merchantProducts = sqliteTable(
  "merchant_products",
  {
    id: text("id").primaryKey(),
    canonicalProductId: text("canonical_product_id").references(
      () => canonicalProducts.id,
      { onDelete: "set null" }
    ),
    source: text("source").notNull(),
    market: text("market").notNull(),
    externalId: text("external_id").notNull(),
    identityKey: text("identity_key"),
    gtin: text("gtin"),
    title: text("title").notNull(),
    brand: text("brand"),
    model: text("model"),
    url: text("url").notNull(),
    variantKey: text("variant_key"),
    matchMethod: text("match_method").notNull(),
    matchScore: integer("match_score").notNull(),
    reviewStatus: text("review_status").notNull().default("needs_review"),
    lastSeenAt: text("last_seen_at").notNull(),
    createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
    updatedAt: text("updated_at").notNull().default(sql`CURRENT_TIMESTAMP`),
  },
  (table) => [
    uniqueIndex("merchant_products_source_market_external_unique").on(
      table.source,
      table.market,
      table.externalId
    ),
    index("merchant_products_canonical_idx").on(table.canonicalProductId),
    index("merchant_products_review_idx").on(table.reviewStatus, table.updatedAt),
    index("merchant_products_identity_idx").on(table.identityKey),
    check(
      "merchant_products_source_allowed",
      sql`${table.source} IN ('amazon', 'boulanger', 'cdiscount', 'darty')`
    ),
    check(
      "merchant_products_method_allowed",
      sql`${table.matchMethod} IN ('gtin', 'brand_model', 'identity', 'isolated', 'manual')`
    ),
    check(
      "merchant_products_review_allowed",
      sql`${table.reviewStatus} IN ('automatic', 'confirmed', 'needs_review', 'rejected')`
    ),
    check("merchant_products_score_range", sql`${table.matchScore} BETWEEN 0 AND 100`),
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
    canonicalProductId: text("canonical_product_id").references(
      () => canonicalProducts.id,
      { onDelete: "set null" }
    ),
    identityKey: text("identity_key"),
    title: text("title").notNull(),
    brand: text("brand"),
    model: text("model"),
    gtin: text("gtin"),
    category: text("category"),
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
    publicPriceCents: integer("public_price_cents"),
    priceAccessibleToAll: integer("price_accessible_to_all", { mode: "boolean" })
      .notNull()
      .default(true),
    promotionType: text("promotion_type").notNull().default("public_price"),
    promotionLabel: text("promotion_label"),
    deliveryCountry: text("delivery_country"),
    deliveryPostalPrefix: text("delivery_postal_prefix"),
    deliveryMode: text("delivery_mode"),
    locationVerified: integer("location_verified", { mode: "boolean" })
      .notNull()
      .default(false),
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
    index("alerts_identity_observed_idx").on(table.identityKey, table.observedAt),
    index("alerts_canonical_observed_idx").on(table.canonicalProductId, table.observedAt),
    index("alerts_category_price_idx").on(table.category, table.publicPriceCents),
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
    check("alerts_public_price_nonnegative", sql`${table.publicPriceCents} >= 0`),
    check(
      "alerts_promotion_type_allowed",
      sql`${table.promotionType} IN ('public_price', 'coupon', 'membership', 'cashback', 'trade_in', 'bundle', 'unknown')`
    ),
    check(
      "alerts_delivery_mode_allowed",
      sql`${table.deliveryMode} IS NULL OR ${table.deliveryMode} IN ('home', 'pickup', 'either')`
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

export const sourceConfigurations = sqliteTable(
  "source_configurations",
  {
    id: text("id").primaryKey(),
    source: text("source").notNull(),
    market: text("market").notNull(),
    displayName: text("display_name").notNull(),
    discoveryUrl: text("discovery_url").notNull(),
    category: text("category").notNull().default("Général"),
    enabled: integer("enabled", { mode: "boolean" }).notNull().default(true),
    cadenceMinutes: integer("cadence_minutes").notNull().default(60),
    volatilityScore: integer("volatility_score").notNull().default(50),
    lastRunAt: text("last_run_at"),
    lastSuccessAt: text("last_success_at"),
    productsSeen: integer("products_seen").notNull().default(0),
    duplicateUrls: integer("duplicate_urls").notNull().default(0),
    pausedReason: text("paused_reason"),
    circuitState: text("circuit_state").notNull().default("closed"),
    failureStreak: integer("failure_streak").notNull().default(0),
    antiBotStreak: integer("anti_bot_streak").notNull().default(0),
    circuitOpenedAt: text("circuit_opened_at"),
    cooldownUntil: text("cooldown_until"),
    lastErrorCode: text("last_error_code"),
    dailyProductBudget: integer("daily_product_budget").notNull().default(500),
    createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
    updatedAt: text("updated_at").notNull().default(sql`CURRENT_TIMESTAMP`),
  },
  (table) => [
    uniqueIndex("source_config_source_market_url_unique").on(
      table.source,
      table.market,
      table.discoveryUrl
    ),
    index("source_config_enabled_due_idx").on(table.enabled, table.lastRunAt),
    check("source_config_cadence_range", sql`${table.cadenceMinutes} BETWEEN 15 AND 1440`),
    check("source_config_volatility_range", sql`${table.volatilityScore} BETWEEN 0 AND 100`),
    check("source_config_products_nonnegative", sql`${table.productsSeen} >= 0`),
    check("source_config_duplicates_nonnegative", sql`${table.duplicateUrls} >= 0`),
    check(
      "source_config_circuit_allowed",
      sql`${table.circuitState} IN ('closed', 'open', 'half_open')`
    ),
    check("source_config_failure_nonnegative", sql`${table.failureStreak} >= 0`),
    check("source_config_antibot_nonnegative", sql`${table.antiBotStreak} >= 0`),
    check(
      "source_config_daily_budget_range",
      sql`${table.dailyProductBudget} BETWEEN 1 AND 100000`
    ),
  ]
);

export const discoverySegments = sqliteTable(
  "discovery_segments",
  {
    id: text("id").primaryKey(),
    source: text("source").notNull().default("amazon"),
    market: text("market").notNull(),
    label: text("label").notNull(),
    categoryIdsJson: text("category_ids_json").notNull().default("[]"),
    minPriceCents: integer("min_price_cents").notNull().default(1),
    maxPriceCents: integer("max_price_cents").notNull().default(100000000),
    minimumDropPercent: integer("minimum_drop_percent").notNull().default(30),
    dailyTokenBudget: integer("daily_token_budget").notNull().default(96),
    cadenceMinutes: integer("cadence_minutes").notNull().default(60),
    priority: integer("priority").notNull().default(50),
    enabled: integer("enabled", { mode: "boolean" }).notNull().default(true),
    lastRunAt: text("last_run_at"),
    lastYieldCount: integer("last_yield_count").notNull().default(0),
    createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
    updatedAt: text("updated_at").notNull().default(sql`CURRENT_TIMESTAMP`),
  },
  (table) => [
    uniqueIndex("discovery_segments_market_label_unique").on(table.market, table.label),
    index("discovery_segments_enabled_due_idx").on(table.enabled, table.lastRunAt),
    index("discovery_segments_priority_idx").on(table.priority, table.updatedAt),
    check("discovery_segments_source_amazon", sql`${table.source} = 'amazon'`),
    check(
      "discovery_segments_market_allowed",
      sql`${table.market} IN ('FR', 'DE', 'IT', 'ES', 'GB')`
    ),
    check(
      "discovery_segments_price_range",
      sql`${table.minPriceCents} >= 1 AND ${table.maxPriceCents} >= ${table.minPriceCents}`
    ),
    check(
      "discovery_segments_drop_range",
      sql`${table.minimumDropPercent} BETWEEN 20 AND 90`
    ),
    check(
      "discovery_segments_budget_range",
      sql`${table.dailyTokenBudget} BETWEEN 1 AND 100000`
    ),
    check(
      "discovery_segments_cadence_range",
      sql`${table.cadenceMinutes} BETWEEN 15 AND 1440`
    ),
    check("discovery_segments_priority_range", sql`${table.priority} BETWEEN 0 AND 100`),
    check("discovery_segments_yield_nonnegative", sql`${table.lastYieldCount} >= 0`),
  ]
);

export const collectionRuns = sqliteTable(
  "collection_runs",
  {
    id: text("id").primaryKey(),
    source: text("source").notNull(),
    market: text("market").notNull(),
    status: text("status").notNull(),
    productsSeen: integer("products_seen").notNull().default(0),
    queueLag: integer("queue_lag").notNull().default(0),
    duplicatesSkipped: integer("duplicates_skipped").notNull().default(0),
    antiBotBlocked: integer("anti_bot_blocked", { mode: "boolean" }).notNull().default(false),
    keepaRequests: integer("keepa_requests").notNull().default(0),
    discoverySegmentId: text("discovery_segment_id"),
    apifyCostMicros: integer("apify_cost_micros"),
    errorCode: text("error_code"),
    attemptedAt: text("attempted_at").notNull(),
    createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
  },
  (table) => [
    index("collection_runs_source_attempt_idx").on(table.source, table.attemptedAt),
    index("collection_runs_attempt_idx").on(table.attemptedAt),
    index("collection_runs_segment_attempt_idx").on(table.discoverySegmentId, table.attemptedAt),
    check("collection_runs_products_nonnegative", sql`${table.productsSeen} >= 0`),
    check("collection_runs_queue_nonnegative", sql`${table.queueLag} >= 0`),
    check("collection_runs_duplicates_nonnegative", sql`${table.duplicatesSkipped} >= 0`),
    check("collection_runs_keepa_nonnegative", sql`${table.keepaRequests} >= 0`),
    check("collection_runs_cost_nonnegative", sql`${table.apifyCostMicros} >= 0`),
  ]
);

export const alertFeedback = sqliteTable(
  "alert_feedback",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    alertId: text("alert_id").notNull().references(() => alerts.id, { onDelete: "cascade" }),
    ownerId: text("owner_id").notNull(),
    verdict: text("verdict").notNull(),
    createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
    updatedAt: text("updated_at").notNull().default(sql`CURRENT_TIMESTAMP`),
  },
  (table) => [
    uniqueIndex("alert_feedback_owner_alert_unique").on(table.ownerId, table.alertId),
    index("alert_feedback_alert_verdict_idx").on(table.alertId, table.verdict),
    check("alert_feedback_verdict_allowed", sql`${table.verdict} IN ('useful', 'false_positive', 'expired')`),
  ]
);

export const privacyConsents = sqliteTable(
  "privacy_consents",
  {
    ownerId: text("owner_id").primaryKey(),
    analytics: integer("analytics", { mode: "boolean" }).notNull().default(false),
    affiliateLinks: integer("affiliate_links", { mode: "boolean" }).notNull().default(false),
    policyVersion: text("policy_version").notNull().default("2026-07"),
    updatedAt: text("updated_at").notNull().default(sql`CURRENT_TIMESTAMP`),
  }
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
    minDiscount: integer("min_discount").notNull().default(20),
    maxPriceCents: integer("max_price_cents"),
    marketsJson: text("markets_json").notNull().default("[]"),
    categoriesJson: text("categories_json").notNull().default("[]"),
    sourcesJson: text("sources_json").notNull().default("[]"),
    deliveryCountry: text("delivery_country").notNull().default("FR"),
    postalCode: text("postal_code"),
    deliveryMode: text("delivery_mode").notNull().default("either"),
    requireLocationMatch: integer("require_location_match", { mode: "boolean" })
      .notNull()
      .default(false),
    createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
    updatedAt: text("updated_at").notNull().default(sql`CURRENT_TIMESTAMP`),
  },
  (table) => [
    check(
      "user_preferences_min_score_range",
      sql`${table.minScore} BETWEEN 60 AND 95`
    ),
    check("user_preferences_min_discount_range", sql`${table.minDiscount} BETWEEN 0 AND 90`),
    check("user_preferences_max_price_positive", sql`${table.maxPriceCents} > 0`),
    check(
      "user_preferences_delivery_country_format",
      sql`length(${table.deliveryCountry}) = 2`
    ),
    check(
      "user_preferences_delivery_mode_allowed",
      sql`${table.deliveryMode} IN ('home', 'pickup', 'either')`
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
