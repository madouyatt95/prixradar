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
      sql`${table.source} IN ('amazon', 'boulanger', 'carrefour', 'castorama', 'cdiscount', 'conforama', 'darty', 'fnac', 'jd_sports', 'leroy_merlin', 'rueducommerce')`
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
    buyNowScore: integer("buy_now_score").notNull().default(0),
    buyNowJson: text("buy_now_json").notNull().default("{}"),
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
      sql`${table.source} IN ('amazon', 'boulanger', 'carrefour', 'castorama', 'cdiscount', 'conforama', 'darty', 'fnac', 'jd_sports', 'leroy_merlin', 'rueducommerce')`
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
    check("alerts_buy_now_score_range", sql`${table.buyNowScore} BETWEEN 0 AND 100`),
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

export const communitySignals = sqliteTable(
  "community_signals",
  {
    id: text("id").primaryKey(),
    provider: text("provider").notNull().default("dealabs"),
    externalId: text("external_id").notNull(),
    title: text("title").notNull(),
    merchant: text("merchant").notNull(),
    category: text("category"),
    dealUrl: text("deal_url").notNull(),
    merchantUrl: text("merchant_url"),
    imageUrl: text("image_url"),
    source: text("source"),
    market: text("market"),
    productId: text("product_id"),
    currency: text("currency").notNull().default("EUR"),
    priceCents: integer("price_cents"),
    temperature: integer("temperature").notNull().default(0),
    velocityX100: integer("velocity_x100").notNull().default(0),
    status: text("status").notNull().default("new"),
    inspectionRequestId: text("inspection_request_id"),
    publishedAt: text("published_at").notNull(),
    firstSeenAt: text("first_seen_at").notNull().default(sql`CURRENT_TIMESTAMP`),
    lastSeenAt: text("last_seen_at").notNull().default(sql`CURRENT_TIMESTAMP`),
    createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
    updatedAt: text("updated_at").notNull().default(sql`CURRENT_TIMESTAMP`),
  },
  (table) => [
    uniqueIndex("community_signals_provider_external_unique").on(table.provider, table.externalId),
    index("community_signals_status_seen_idx").on(table.status, table.lastSeenAt),
    index("community_signals_temperature_seen_idx").on(table.temperature, table.lastSeenAt),
    index("community_signals_product_idx").on(table.source, table.market, table.productId),
    check("community_signals_provider_allowed", sql`${table.provider} = 'dealabs'`),
    check("community_signals_currency_allowed", sql`${table.currency} IN ('EUR', 'GBP')`),
    check("community_signals_price_nonnegative", sql`${table.priceCents} >= 0`),
    check("community_signals_temperature_nonnegative", sql`${table.temperature} >= 0`),
    check("community_signals_velocity_nonnegative", sql`${table.velocityX100} >= 0`),
    check("community_signals_status_allowed", sql`${table.status} IN ('new', 'heating', 'hot', 'cooling', 'stale')`),
  ],
);

export const communitySignalObservations = sqliteTable(
  "community_signal_observations",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    signalId: text("signal_id").notNull().references(() => communitySignals.id, { onDelete: "cascade" }),
    temperature: integer("temperature").notNull(),
    observedAt: text("observed_at").notNull(),
  },
  (table) => [
    uniqueIndex("community_signal_observation_unique").on(table.signalId, table.temperature, table.observedAt),
    index("community_signal_observation_signal_seen_idx").on(table.signalId, table.observedAt),
    check("community_signal_observations_temperature_nonnegative", sql`${table.temperature} >= 0`),
  ],
);

export const alertIntelligence = sqliteTable(
  "alert_intelligence",
  {
    alertId: text("alert_id").primaryKey().references(() => alerts.id, { onDelete: "cascade" }),
    variantFingerprint: text("variant_fingerprint").notNull(),
    variantJson: text("variant_json").notNull().default("{}"),
    variantConfidence: integer("variant_confidence").notNull().default(0),
    shadowCartStatus: text("shadow_cart_status").notNull().default("product_page"),
    shadowCartJson: text("shadow_cart_json").notNull().default("{}"),
    finalTotalCents: integer("final_total_cents"),
    priceIndexCents: integer("price_index_cents").notNull(),
    priceIndexJson: text("price_index_json").notNull().default("{}"),
    marketPosition: text("market_position").notNull().default("market"),
    anomalyKind: text("anomaly_kind").notNull().default("insufficient_evidence"),
    anomalyJson: text("anomaly_json").notNull().default("{}"),
    sellerScore: integer("seller_score").notNull().default(0),
    sellerJson: text("seller_json").notNull().default("{}"),
    urgencyScore: integer("urgency_score").notNull().default(0),
    predictedLifetimeMinutes: integer("predicted_lifetime_minutes").notNull().default(0),
    predictedExpiresAt: text("predicted_expires_at"),
    updatedAt: text("updated_at").notNull().default(sql`CURRENT_TIMESTAMP`),
  },
  (table) => [
    index("alert_intelligence_kind_score_idx").on(table.anomalyKind, table.urgencyScore),
    index("alert_intelligence_cart_updated_idx").on(table.shadowCartStatus, table.updatedAt),
    index("alert_intelligence_variant_idx").on(table.variantFingerprint),
    check("alert_intelligence_variant_confidence_range", sql`${table.variantConfidence} BETWEEN 0 AND 100`),
    check("alert_intelligence_seller_score_range", sql`${table.sellerScore} BETWEEN 0 AND 100`),
    check("alert_intelligence_urgency_score_range", sql`${table.urgencyScore} BETWEEN 0 AND 100`),
    check("alert_intelligence_lifetime_nonnegative", sql`${table.predictedLifetimeMinutes} >= 0`),
    check("alert_intelligence_total_nonnegative", sql`${table.finalTotalCents} >= 0`),
    check("alert_intelligence_index_positive", sql`${table.priceIndexCents} > 0`),
    check("alert_intelligence_cart_allowed", sql`${table.shadowCartStatus} IN ('confirmed', 'product_page', 'blocked', 'unavailable')`),
    check("alert_intelligence_position_allowed", sql`${table.marketPosition} IN ('best', 'below_market', 'market', 'above_market')`),
    check("alert_intelligence_kind_allowed", sql`${table.anomalyKind} IN ('true_anomaly', 'promotion', 'wrong_variant', 'seller_risk', 'conditional_price', 'shipping_unknown', 'refurbished', 'insufficient_evidence')`),
  ]
);

export const inspectionRequests = sqliteTable(
  "inspection_requests",
  {
    id: text("id").primaryKey(),
    ownerId: text("owner_id").notNull(),
    url: text("url").notNull(),
    source: text("source").notNull(),
    market: text("market").notNull(),
    status: text("status").notNull().default("pending"),
    resultJson: text("result_json").notNull().default("{}"),
    requestedAt: text("requested_at").notNull().default(sql`CURRENT_TIMESTAMP`),
    claimedAt: text("claimed_at"),
    completedAt: text("completed_at"),
    updatedAt: text("updated_at").notNull().default(sql`CURRENT_TIMESTAMP`),
  },
  (table) => [
    index("inspection_requests_status_requested_idx").on(table.status, table.requestedAt),
    index("inspection_requests_owner_updated_idx").on(table.ownerId, table.updatedAt),
    index("inspection_requests_url_status_idx").on(table.url, table.status),
    check("inspection_requests_status_allowed", sql`${table.status} IN ('pending', 'processing', 'completed', 'failed')`),
    check("inspection_requests_source_allowed", sql`${table.source} IN ('amazon', 'boulanger', 'carrefour', 'castorama', 'cdiscount', 'conforama', 'darty', 'fnac', 'jd_sports', 'leroy_merlin', 'rueducommerce')`),
  ]
);

export const eanScanRequests = sqliteTable(
  "ean_scan_requests",
  {
    id: text("id").primaryKey(),
    ownerId: text("owner_id").notNull(),
    gtin: text("gtin").notNull(),
    status: text("status").notNull().default("queued"),
    radarRuleId: text("radar_rule_id"),
    canonicalProductId: text("canonical_product_id").references(
      () => canonicalProducts.id,
      { onDelete: "set null" }
    ),
    matchedAlertId: text("matched_alert_id").references(() => alerts.id, {
      onDelete: "set null",
    }),
    resultJson: text("result_json").notNull().default("{}"),
    requestedAt: text("requested_at").notNull().default(sql`CURRENT_TIMESTAMP`),
    claimedAt: text("claimed_at"),
    lastCheckedAt: text("last_checked_at"),
    nextCheckAt: text("next_check_at").notNull().default(sql`CURRENT_TIMESTAMP`),
    updatedAt: text("updated_at").notNull().default(sql`CURRENT_TIMESTAMP`),
  },
  (table) => [
    uniqueIndex("ean_scan_owner_gtin_unique").on(table.ownerId, table.gtin),
    index("ean_scan_status_due_idx").on(table.status, table.nextCheckAt),
    index("ean_scan_owner_updated_idx").on(table.ownerId, table.updatedAt),
    index("ean_scan_gtin_idx").on(table.gtin),
    check(
      "ean_scan_status_allowed",
      sql`${table.status} IN ('queued', 'processing', 'monitoring', 'matched', 'failed')`
    ),
  ]
);

export const sentinelFrontier = sqliteTable(
  "sentinel_frontier",
  {
    id: text("id").primaryKey(),
    url: text("url").notNull(),
    source: text("source").notNull(),
    market: text("market").notNull(),
    discoveredFrom: text("discovered_from"),
    discoveryType: text("discovery_type").notNull().default("link"),
    depth: integer("depth").notNull().default(0),
    status: text("status").notNull().default("queued"),
    priority: integer("priority").notNull().default(50),
    lastSeenAt: text("last_seen_at").notNull().default(sql`CURRENT_TIMESTAMP`),
    lastScannedAt: text("last_scanned_at"),
    nextScanAt: text("next_scan_at").notNull().default(sql`CURRENT_TIMESTAMP`),
    hits: integer("hits").notNull().default(0),
    duplicateCount: integer("duplicate_count").notNull().default(0),
    createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
    updatedAt: text("updated_at").notNull().default(sql`CURRENT_TIMESTAMP`),
  },
  (table) => [
    uniqueIndex("sentinel_frontier_url_unique").on(table.url),
    index("sentinel_frontier_due_priority_idx").on(table.status, table.nextScanAt, table.priority),
    index("sentinel_frontier_source_market_idx").on(table.source, table.market),
    check("sentinel_frontier_status_allowed", sql`${table.status} IN ('queued', 'processing', 'active', 'blocked')`),
    check("sentinel_frontier_priority_range", sql`${table.priority} BETWEEN 0 AND 100`),
    check("sentinel_frontier_depth_nonnegative", sql`${table.depth} >= 0`),
    check("sentinel_frontier_hits_nonnegative", sql`${table.hits} >= 0`),
    check("sentinel_frontier_duplicates_nonnegative", sql`${table.duplicateCount} >= 0`),
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
    discoveryStrategy: text("discovery_strategy").notNull().default("links"),
    pageCursor: text("page_cursor"),
    estimatedProductCount: integer("estimated_product_count"),
    uniqueProductsSeen: integer("unique_products_seen").notNull().default(0),
    coveragePercent: integer("coverage_percent").notNull().default(0),
    contractStatus: text("contract_status").notNull().default("untested"),
    lastContractCheckAt: text("last_contract_check_at"),
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
    check("source_config_discovery_strategy_allowed", sql`${table.discoveryStrategy} IN ('links', 'sitemap', 'feed', 'api')`),
    check("source_config_estimated_products_positive", sql`${table.estimatedProductCount} > 0`),
    check("source_config_unique_products_nonnegative", sql`${table.uniqueProductsSeen} >= 0`),
    check("source_config_coverage_range", sql`${table.coveragePercent} BETWEEN 0 AND 100`),
    check("source_config_contract_status_allowed", sql`${table.contractStatus} IN ('untested', 'passing', 'degraded', 'failing')`),
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

export const sourceCoverageProducts = sqliteTable(
  "source_coverage_products",
  {
    sourceConfigurationId: text("source_configuration_id")
      .notNull()
      .references(() => sourceConfigurations.id, { onDelete: "cascade" }),
    productKey: text("product_key").notNull(),
    productUrl: text("product_url").notNull(),
    firstSeenAt: text("first_seen_at").notNull().default(sql`CURRENT_TIMESTAMP`),
    lastSeenAt: text("last_seen_at").notNull().default(sql`CURRENT_TIMESTAMP`),
  },
  (table) => [
    uniqueIndex("source_coverage_config_product_unique").on(
      table.sourceConfigurationId,
      table.productKey,
    ),
    index("source_coverage_product_key_idx").on(table.productKey),
    index("source_coverage_product_url_idx").on(table.productUrl),
    index("source_coverage_config_last_seen_idx").on(table.sourceConfigurationId, table.lastSeenAt),
  ],
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
    check("alert_feedback_verdict_allowed", sql`${table.verdict} IN ('useful', 'false_positive', 'expired', 'purchased', 'cancelled', 'wrong_variant', 'coupon_failed', 'price_confirmed')`),
  ]
);

export const radarRules = sqliteTable(
  "radar_rules",
  {
    id: text("id").primaryKey(),
    ownerId: text("owner_id").notNull(),
    name: text("name").notNull(),
    query: text("query").notNull(),
    intentJson: text("intent_json").notNull(),
    kind: text("kind").notNull().default("single"),
    status: text("status").notNull().default("active"),
    budgetCents: integer("budget_cents"),
    deadlineAt: text("deadline_at"),
    allowAlternatives: integer("allow_alternatives", { mode: "boolean" })
      .notNull()
      .default(true),
    completedAt: text("completed_at"),
    enabled: integer("enabled", { mode: "boolean" }).notNull().default(true),
    createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
    updatedAt: text("updated_at").notNull().default(sql`CURRENT_TIMESTAMP`),
  },
  (table) => [
    index("radar_rules_owner_enabled_idx").on(table.ownerId, table.enabled),
    index("radar_rules_owner_status_idx").on(table.ownerId, table.status),
    index("radar_rules_updated_idx").on(table.updatedAt),
    check("radar_rules_kind_allowed", sql`${table.kind} IN ('single', 'project')`),
    check("radar_rules_status_allowed", sql`${table.status} IN ('active', 'paused', 'completed')`),
    check("radar_rules_budget_positive", sql`${table.budgetCents} > 0`),
  ]
);

export const missionItems = sqliteTable(
  "mission_items",
  {
    id: text("id").primaryKey(),
    missionId: text("mission_id").notNull().references(() => radarRules.id, { onDelete: "cascade" }),
    ownerId: text("owner_id").notNull(),
    label: text("label").notNull(),
    query: text("query").notNull(),
    intentJson: text("intent_json").notNull(),
    quantity: integer("quantity").notNull().default(1),
    required: integer("required", { mode: "boolean" }).notNull().default(true),
    targetPriceCents: integer("target_price_cents"),
    selectedAlertId: text("selected_alert_id").references(() => alerts.id, { onDelete: "set null" }),
    status: text("status").notNull().default("searching"),
    createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
    updatedAt: text("updated_at").notNull().default(sql`CURRENT_TIMESTAMP`),
  },
  (table) => [
    index("mission_items_mission_status_idx").on(table.missionId, table.status),
    index("mission_items_owner_updated_idx").on(table.ownerId, table.updatedAt),
    check("mission_items_quantity_range", sql`${table.quantity} BETWEEN 1 AND 99`),
    check("mission_items_target_positive", sql`${table.targetPriceCents} > 0`),
    check("mission_items_status_allowed", sql`${table.status} IN ('searching', 'matched', 'purchased', 'skipped')`),
  ]
);

export const purchases = sqliteTable(
  "purchases",
  {
    id: text("id").primaryKey(),
    ownerId: text("owner_id").notNull(),
    alertId: text("alert_id").references(() => alerts.id, { onDelete: "set null" }),
    missionId: text("mission_id").references(() => radarRules.id, { onDelete: "set null" }),
    missionItemId: text("mission_item_id").references(() => missionItems.id, { onDelete: "set null" }),
    source: text("source").notNull(),
    market: text("market").notNull(),
    productId: text("product_id").notNull(),
    title: text("title").notNull(),
    url: text("url").notNull(),
    currency: text("currency").notNull(),
    paidTotalCents: integer("paid_total_cents").notNull(),
    referencePriceCents: integer("reference_price_cents").notNull(),
    realizedSavingsCents: integer("realized_savings_cents").notNull().default(0),
    latestPriceCents: integer("latest_price_cents"),
    bestPriceCents: integer("best_price_cents"),
    potentialRecoveryCents: integer("potential_recovery_cents").notNull().default(0),
    status: text("status").notNull().default("protected"),
    actionReason: text("action_reason"),
    purchasedAt: text("purchased_at").notNull(),
    deliveredAt: text("delivered_at"),
    protectionEndsAt: text("protection_ends_at").notNull(),
    lastCheckedAt: text("last_checked_at"),
    nextCheckAt: text("next_check_at").notNull(),
    createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
    updatedAt: text("updated_at").notNull().default(sql`CURRENT_TIMESTAMP`),
  },
  (table) => [
    uniqueIndex("purchases_owner_alert_unique").on(table.ownerId, table.alertId),
    index("purchases_owner_purchased_idx").on(table.ownerId, table.purchasedAt),
    index("purchases_protection_due_idx").on(table.status, table.nextCheckAt, table.protectionEndsAt),
    index("purchases_product_lookup_idx").on(table.source, table.market, table.productId),
    check("purchases_paid_positive", sql`${table.paidTotalCents} > 0`),
    check("purchases_reference_positive", sql`${table.referencePriceCents} > 0`),
    check("purchases_savings_nonnegative", sql`${table.realizedSavingsCents} >= 0`),
    check("purchases_latest_nonnegative", sql`${table.latestPriceCents} >= 0`),
    check("purchases_best_nonnegative", sql`${table.bestPriceCents} >= 0`),
    check("purchases_recovery_nonnegative", sql`${table.potentialRecoveryCents} >= 0`),
    check("purchases_currency_allowed", sql`${table.currency} IN ('EUR', 'GBP')`),
    check("purchases_status_allowed", sql`${table.status} IN ('protected', 'action_available', 'kept', 'returned', 'closed')`),
  ]
);

export const purchaseEvents = sqliteTable(
  "purchase_events",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    purchaseId: text("purchase_id").notNull().references(() => purchases.id, { onDelete: "cascade" }),
    eventType: text("event_type").notNull(),
    priceCents: integer("price_cents"),
    note: text("note"),
    occurredAt: text("occurred_at").notNull().default(sql`CURRENT_TIMESTAMP`),
  },
  (table) => [
    index("purchase_events_purchase_time_idx").on(table.purchaseId, table.occurredAt),
    check("purchase_events_price_nonnegative", sql`${table.priceCents} >= 0`),
    check("purchase_events_type_allowed", sql`${table.eventType} IN ('purchased', 'price_checked', 'price_drop', 'action_opened', 'returned', 'kept', 'closed')`),
  ]
);

export const recheckRequests = sqliteTable(
  "recheck_requests",
  {
    id: text("id").primaryKey(),
    alertId: text("alert_id").notNull().references(() => alerts.id, { onDelete: "cascade" }),
    ownerId: text("owner_id").notNull(),
    source: text("source").notNull(),
    market: text("market").notNull(),
    url: text("url").notNull(),
    status: text("status").notNull().default("pending"),
    resultJson: text("result_json").notNull().default("{}"),
    requestedAt: text("requested_at").notNull().default(sql`CURRENT_TIMESTAMP`),
    claimedAt: text("claimed_at"),
    completedAt: text("completed_at"),
    updatedAt: text("updated_at").notNull().default(sql`CURRENT_TIMESTAMP`),
  },
  (table) => [
    index("recheck_requests_status_requested_idx").on(table.status, table.requestedAt),
    index("recheck_requests_owner_updated_idx").on(table.ownerId, table.updatedAt),
    index("recheck_requests_alert_status_idx").on(table.alertId, table.status),
    check(
      "recheck_requests_status_allowed",
      sql`${table.status} IN ('pending', 'processing', 'completed', 'failed')`
    ),
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

export const protectionNotifications = sqliteTable(
  "protection_notifications",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    purchaseId: text("purchase_id").notNull().references(() => purchases.id, { onDelete: "cascade" }),
    subscriptionId: integer("subscription_id").notNull().references(() => pushSubscriptions.id, { onDelete: "cascade" }),
    ownerId: text("owner_id").notNull(),
    priceCents: integer("price_cents").notNull(),
    status: text("status").notNull().default("reserved"),
    dedupeKey: text("dedupe_key").notNull(),
    attemptedAt: text("attempted_at").notNull().default(sql`CURRENT_TIMESTAMP`),
    sentAt: text("sent_at"),
    errorCode: text("error_code"),
  },
  (table) => [
    uniqueIndex("protection_notifications_dedupe_unique").on(table.dedupeKey),
    index("protection_notifications_purchase_idx").on(table.purchaseId, table.attemptedAt),
    index("protection_notifications_owner_idx").on(table.ownerId, table.attemptedAt),
    check("protection_notifications_price_positive", sql`${table.priceCents} > 0`),
    check("protection_notifications_status_allowed", sql`${table.status} IN ('reserved', 'sent', 'failed')`),
  ]
);

export const userPreferences = sqliteTable(
  "user_preferences",
  {
    ownerId: text("owner_id").primaryKey(),
    experienceLevel: text("experience_level").notNull().default("essential"),
    preset: text("preset").notNull().default("balanced"),
    minScore: integer("min_score").notNull().default(75),
    minSellerScore: integer("min_seller_score").notNull().default(70),
    requireExactVariant: integer("require_exact_variant", { mode: "boolean" })
      .notNull()
      .default(true),
    requireCartConfirmation: integer("require_cart_confirmation", { mode: "boolean" })
      .notNull()
      .default(true),
    maxAlertAgeMinutes: integer("max_alert_age_minutes").notNull().default(60),
    minimumHistoryPoints: integer("minimum_history_points").notNull().default(5),
    closeExpiredMinutes: integer("close_expired_minutes").notNull().default(10),
    quietHours: integer("quiet_hours", { mode: "boolean" })
      .notNull()
      .default(false),
    quietStart: text("quiet_start").notNull().default("22:00"),
    quietEnd: text("quiet_end").notNull().default("08:00"),
    timezone: text("timezone").notNull().default("Europe/Paris"),
    notificationEnabled: integer("notification_enabled", { mode: "boolean" })
      .notNull()
      .default(true),
    socialNotificationsEnabled: integer("social_notifications_enabled", { mode: "boolean" })
      .notNull()
      .default(false),
    notificationSpeed: text("notification_speed").notNull().default("balanced"),
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
      "user_preferences_experience_level_allowed",
      sql`${table.experienceLevel} IN ('essential', 'expert')`
    ),
    check(
      "user_preferences_preset_allowed",
      sql`${table.preset} IN ('safe', 'balanced', 'fast')`
    ),
    check(
      "user_preferences_min_score_range",
      sql`${table.minScore} BETWEEN 60 AND 95`
    ),
    check("user_preferences_min_seller_score_range", sql`${table.minSellerScore} BETWEEN 0 AND 100`),
    check("user_preferences_max_alert_age_range", sql`${table.maxAlertAgeMinutes} BETWEEN 5 AND 180`),
    check("user_preferences_min_history_range", sql`${table.minimumHistoryPoints} BETWEEN 3 AND 60`),
    check("user_preferences_close_expired_range", sql`${table.closeExpiredMinutes} BETWEEN 2 AND 60`),
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
    check(
      "user_preferences_notification_speed_allowed",
      sql`${table.notificationSpeed} IN ('instant', 'balanced', 'digest')`
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
    tier: text("tier").notNull().default("personal"),
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
    check(
      "notification_deliveries_tier_allowed",
      sql`${table.tier} IN ('urgent', 'personal', 'digest')`
    ),
  ]
);

export const socialSources = sqliteTable(
  "social_sources",
  {
    id: text("id").primaryKey(),
    platform: text("platform").notNull(),
    name: text("name").notNull(),
    externalId: text("external_id").notNull(),
    url: text("url").notNull(),
    collectionMode: text("collection_mode").notNull(),
    enabled: integer("enabled", { mode: "boolean" }).notNull().default(true),
    status: text("status").notNull().default("ready"),
    cadenceMinutes: integer("cadence_minutes").notNull().default(15),
    lastAttemptAt: text("last_attempt_at"),
    lastSuccessAt: text("last_success_at"),
    lastErrorCode: text("last_error_code"),
    createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
    updatedAt: text("updated_at").notNull().default(sql`CURRENT_TIMESTAMP`),
  },
  (table) => [
    uniqueIndex("social_sources_platform_external_unique").on(table.platform, table.externalId),
    index("social_sources_enabled_status_idx").on(table.enabled, table.status),
    check("social_sources_platform_allowed", sql`${table.platform} IN ('facebook', 'x')`),
    check("social_sources_mode_allowed", sql`${table.collectionMode} IN ('public_browser', 'x_api')`),
    check("social_sources_status_allowed", sql`${table.status} IN ('ready', 'live', 'degraded', 'blocked', 'awaiting_access')`),
    check("social_sources_cadence_range", sql`${table.cadenceMinutes} BETWEEN 1 AND 1440`),
  ],
);

export const socialPublications = sqliteTable(
  "social_publications",
  {
    id: text("id").primaryKey(),
    sourceId: text("source_id").notNull().references(() => socialSources.id, { onDelete: "cascade" }),
    externalId: text("external_id").notNull(),
    author: text("author").notNull(),
    text: text("text").notNull(),
    publicationUrl: text("publication_url").notNull(),
    imageUrl: text("image_url"),
    externalUrl: text("external_url"),
    publishedAt: text("published_at").notNull(),
    firstSeenAt: text("first_seen_at").notNull().default(sql`CURRENT_TIMESTAMP`),
    lastSeenAt: text("last_seen_at").notNull().default(sql`CURRENT_TIMESTAMP`),
    createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
    updatedAt: text("updated_at").notNull().default(sql`CURRENT_TIMESTAMP`),
  },
  (table) => [
    uniqueIndex("social_publications_source_external_unique").on(table.sourceId, table.externalId),
    index("social_publications_published_idx").on(table.publishedAt),
    index("social_publications_source_published_idx").on(table.sourceId, table.publishedAt),
  ],
);

export const socialCollectionRuns = sqliteTable(
  "social_collection_runs",
  {
    id: text("id").primaryKey(),
    provider: text("provider").notNull().default("apify_facebook_groups"),
    status: text("status").notNull().default("reserved"),
    sourceCount: integer("source_count").notNull(),
    postsReturned: integer("posts_returned").notNull().default(0),
    estimatedCostMicros: integer("estimated_cost_micros").notNull(),
    cursorFrom: text("cursor_from").notNull(),
    providerRunId: text("provider_run_id"),
    startedAt: text("started_at").notNull(),
    finishedAt: text("finished_at"),
    errorCode: text("error_code"),
    createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
    updatedAt: text("updated_at").notNull().default(sql`CURRENT_TIMESTAMP`),
  },
  (table) => [
    index("social_collection_runs_started_idx").on(table.startedAt),
    index("social_collection_runs_status_started_idx").on(table.status, table.startedAt),
    check("social_collection_runs_provider_allowed", sql`${table.provider} IN ('apify_facebook_groups')`),
    check("social_collection_runs_status_allowed", sql`${table.status} IN ('reserved', 'succeeded', 'failed')`),
    check("social_collection_runs_sources_positive", sql`${table.sourceCount} BETWEEN 1 AND 20`),
    check("social_collection_runs_posts_nonnegative", sql`${table.postsReturned} >= 0`),
    check("social_collection_runs_cost_nonnegative", sql`${table.estimatedCostMicros} >= 0`),
  ],
);

export const socialNotificationDeliveries = sqliteTable(
  "social_notification_deliveries",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    publicationId: text("publication_id").notNull().references(() => socialPublications.id, { onDelete: "cascade" }),
    subscriptionId: integer("subscription_id").notNull().references(() => pushSubscriptions.id, { onDelete: "cascade" }),
    ownerId: text("owner_id").notNull(),
    status: text("status").notNull().default("reserved"),
    dedupeKey: text("dedupe_key").notNull(),
    attemptedAt: text("attempted_at").notNull().default(sql`CURRENT_TIMESTAMP`),
    sentAt: text("sent_at"),
    errorCode: text("error_code"),
  },
  (table) => [
    uniqueIndex("social_notification_deliveries_dedupe_unique").on(table.dedupeKey),
    index("social_notification_deliveries_publication_idx").on(table.publicationId, table.attemptedAt),
    index("social_notification_deliveries_owner_idx").on(table.ownerId, table.attemptedAt),
    check("social_notification_deliveries_status_allowed", sql`${table.status} IN ('reserved', 'sent', 'failed', 'suppressed')`),
  ],
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
