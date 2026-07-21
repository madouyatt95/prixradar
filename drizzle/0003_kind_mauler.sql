CREATE TABLE `canonical_products` (
	`id` text PRIMARY KEY NOT NULL,
	`gtin_key` text,
	`title` text NOT NULL,
	`brand` text,
	`brand_key` text,
	`model` text,
	`model_key` text,
	`category` text,
	`review_status` text DEFAULT 'automatic' NOT NULL,
	`match_confidence` integer DEFAULT 0 NOT NULL,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	`updated_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	CONSTRAINT "canonical_products_review_allowed" CHECK("canonical_products"."review_status" IN ('automatic', 'confirmed', 'needs_review')),
	CONSTRAINT "canonical_products_confidence_range" CHECK("canonical_products"."match_confidence" BETWEEN 0 AND 100)
);
--> statement-breakpoint
CREATE UNIQUE INDEX `canonical_products_gtin_unique` ON `canonical_products` (`gtin_key`);--> statement-breakpoint
CREATE INDEX `canonical_products_brand_model_idx` ON `canonical_products` (`brand_key`,`model_key`);--> statement-breakpoint
CREATE INDEX `canonical_products_review_idx` ON `canonical_products` (`review_status`,`updated_at`);--> statement-breakpoint
CREATE TABLE `discovery_segments` (
	`id` text PRIMARY KEY NOT NULL,
	`source` text DEFAULT 'amazon' NOT NULL,
	`market` text NOT NULL,
	`label` text NOT NULL,
	`category_ids_json` text DEFAULT '[]' NOT NULL,
	`min_price_cents` integer DEFAULT 1 NOT NULL,
	`max_price_cents` integer DEFAULT 100000000 NOT NULL,
	`minimum_drop_percent` integer DEFAULT 30 NOT NULL,
	`daily_token_budget` integer DEFAULT 96 NOT NULL,
	`cadence_minutes` integer DEFAULT 60 NOT NULL,
	`priority` integer DEFAULT 50 NOT NULL,
	`enabled` integer DEFAULT true NOT NULL,
	`last_run_at` text,
	`last_yield_count` integer DEFAULT 0 NOT NULL,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	`updated_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	CONSTRAINT "discovery_segments_source_amazon" CHECK("discovery_segments"."source" = 'amazon'),
	CONSTRAINT "discovery_segments_market_allowed" CHECK("discovery_segments"."market" IN ('FR', 'DE', 'IT', 'ES', 'GB')),
	CONSTRAINT "discovery_segments_price_range" CHECK("discovery_segments"."min_price_cents" >= 1 AND "discovery_segments"."max_price_cents" >= "discovery_segments"."min_price_cents"),
	CONSTRAINT "discovery_segments_drop_range" CHECK("discovery_segments"."minimum_drop_percent" BETWEEN 20 AND 90),
	CONSTRAINT "discovery_segments_budget_range" CHECK("discovery_segments"."daily_token_budget" BETWEEN 1 AND 100000),
	CONSTRAINT "discovery_segments_cadence_range" CHECK("discovery_segments"."cadence_minutes" BETWEEN 15 AND 1440),
	CONSTRAINT "discovery_segments_priority_range" CHECK("discovery_segments"."priority" BETWEEN 0 AND 100),
	CONSTRAINT "discovery_segments_yield_nonnegative" CHECK("discovery_segments"."last_yield_count" >= 0)
);
--> statement-breakpoint
CREATE UNIQUE INDEX `discovery_segments_market_label_unique` ON `discovery_segments` (`market`,`label`);--> statement-breakpoint
CREATE INDEX `discovery_segments_enabled_due_idx` ON `discovery_segments` (`enabled`,`last_run_at`);--> statement-breakpoint
CREATE INDEX `discovery_segments_priority_idx` ON `discovery_segments` (`priority`,`updated_at`);--> statement-breakpoint
CREATE TABLE `merchant_products` (
	`id` text PRIMARY KEY NOT NULL,
	`canonical_product_id` text,
	`source` text NOT NULL,
	`market` text NOT NULL,
	`external_id` text NOT NULL,
	`identity_key` text,
	`gtin` text,
	`title` text NOT NULL,
	`brand` text,
	`model` text,
	`url` text NOT NULL,
	`variant_key` text,
	`match_method` text NOT NULL,
	`match_score` integer NOT NULL,
	`review_status` text DEFAULT 'needs_review' NOT NULL,
	`last_seen_at` text NOT NULL,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	`updated_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	FOREIGN KEY (`canonical_product_id`) REFERENCES `canonical_products`(`id`) ON UPDATE no action ON DELETE set null,
	CONSTRAINT "merchant_products_source_allowed" CHECK("merchant_products"."source" IN ('amazon', 'boulanger', 'cdiscount', 'darty')),
	CONSTRAINT "merchant_products_method_allowed" CHECK("merchant_products"."match_method" IN ('gtin', 'brand_model', 'identity', 'isolated', 'manual')),
	CONSTRAINT "merchant_products_review_allowed" CHECK("merchant_products"."review_status" IN ('automatic', 'confirmed', 'needs_review', 'rejected')),
	CONSTRAINT "merchant_products_score_range" CHECK("merchant_products"."match_score" BETWEEN 0 AND 100)
);
--> statement-breakpoint
CREATE UNIQUE INDEX `merchant_products_source_market_external_unique` ON `merchant_products` (`source`,`market`,`external_id`);--> statement-breakpoint
CREATE INDEX `merchant_products_canonical_idx` ON `merchant_products` (`canonical_product_id`);--> statement-breakpoint
CREATE INDEX `merchant_products_review_idx` ON `merchant_products` (`review_status`,`updated_at`);--> statement-breakpoint
CREATE INDEX `merchant_products_identity_idx` ON `merchant_products` (`identity_key`);--> statement-breakpoint
PRAGMA foreign_keys=OFF;--> statement-breakpoint
CREATE TABLE `__new_alerts` (
	`id` text PRIMARY KEY NOT NULL,
	`source` text NOT NULL,
	`source_mode` text NOT NULL,
	`merchant` text NOT NULL,
	`market` text NOT NULL,
	`product_id` text NOT NULL,
	`canonical_product_id` text,
	`identity_key` text,
	`title` text NOT NULL,
	`brand` text,
	`model` text,
	`gtin` text,
	`category` text,
	`url` text NOT NULL,
	`currency` text NOT NULL,
	`price_cents` integer NOT NULL,
	`usual_price_cents` integer NOT NULL,
	`discount_percent` integer NOT NULL,
	`score` integer NOT NULL,
	`confidence` text NOT NULL,
	`status` text NOT NULL,
	`seller` text,
	`condition` text,
	`shipping_cents` integer,
	`public_price_cents` integer,
	`price_accessible_to_all` integer DEFAULT true NOT NULL,
	`promotion_type` text DEFAULT 'public_price' NOT NULL,
	`promotion_label` text,
	`delivery_country` text,
	`delivery_postal_prefix` text,
	`delivery_mode` text,
	`location_verified` integer DEFAULT false NOT NULL,
	`evidence_json` text DEFAULT '{}' NOT NULL,
	`observed_at` text NOT NULL,
	`verified_at` text,
	`expires_at` text,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	`updated_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	FOREIGN KEY (`canonical_product_id`) REFERENCES `canonical_products`(`id`) ON UPDATE no action ON DELETE set null,
	CONSTRAINT "alerts_price_nonnegative" CHECK("price_cents" >= 0),
	CONSTRAINT "alerts_usual_price_positive" CHECK("usual_price_cents" > 0),
	CONSTRAINT "alerts_source_allowed" CHECK("source" IN ('amazon', 'boulanger', 'cdiscount', 'darty')),
	CONSTRAINT "alerts_source_mode_allowed" CHECK("source_mode" IN ('live', 'demo', 'fixture')),
	CONSTRAINT "alerts_confidence_allowed" CHECK("confidence" IN ('very_likely', 'likely', 'review', 'insufficient')),
	CONSTRAINT "alerts_status_allowed" CHECK("status" IN ('active', 'review', 'monitoring', 'expired')),
	CONSTRAINT "alerts_shipping_nonnegative" CHECK("shipping_cents" >= 0),
	CONSTRAINT "alerts_public_price_nonnegative" CHECK("public_price_cents" >= 0),
	CONSTRAINT "alerts_promotion_type_allowed" CHECK("promotion_type" IN ('public_price', 'coupon', 'membership', 'cashback', 'trade_in', 'bundle', 'unknown')),
	CONSTRAINT "alerts_delivery_mode_allowed" CHECK("delivery_mode" IS NULL OR "delivery_mode" IN ('home', 'pickup', 'either')),
	CONSTRAINT "alerts_discount_percent_range" CHECK("discount_percent" BETWEEN 0 AND 100),
	CONSTRAINT "alerts_score_range" CHECK("score" BETWEEN 0 AND 100)
);
--> statement-breakpoint
INSERT INTO `__new_alerts`("id", "source", "source_mode", "merchant", "market", "product_id", "canonical_product_id", "identity_key", "title", "brand", "model", "gtin", "category", "url", "currency", "price_cents", "usual_price_cents", "discount_percent", "score", "confidence", "status", "seller", "condition", "shipping_cents", "public_price_cents", "price_accessible_to_all", "promotion_type", "promotion_label", "delivery_country", "delivery_postal_prefix", "delivery_mode", "location_verified", "evidence_json", "observed_at", "verified_at", "expires_at", "created_at", "updated_at") SELECT "id", "source", "source_mode", "merchant", "market", "product_id", NULL, "identity_key", "title", "brand", "model", "gtin", "category", "url", "currency", "price_cents", "usual_price_cents", "discount_percent", "score", "confidence", "status", "seller", "condition", "shipping_cents", "public_price_cents", "price_accessible_to_all", "promotion_type", "promotion_label", NULL, NULL, NULL, false, "evidence_json", "observed_at", "verified_at", "expires_at", "created_at", "updated_at" FROM `alerts`;--> statement-breakpoint
DROP TABLE `alerts`;--> statement-breakpoint
ALTER TABLE `__new_alerts` RENAME TO `alerts`;--> statement-breakpoint
PRAGMA foreign_keys=ON;--> statement-breakpoint
CREATE INDEX `alerts_status_score_observed_idx` ON `alerts` (`status`,`score`,`observed_at`);--> statement-breakpoint
CREATE INDEX `alerts_source_market_product_idx` ON `alerts` (`source`,`market`,`product_id`);--> statement-breakpoint
CREATE INDEX `alerts_identity_observed_idx` ON `alerts` (`identity_key`,`observed_at`);--> statement-breakpoint
CREATE INDEX `alerts_canonical_observed_idx` ON `alerts` (`canonical_product_id`,`observed_at`);--> statement-breakpoint
CREATE INDEX `alerts_category_price_idx` ON `alerts` (`category`,`public_price_cents`);--> statement-breakpoint
CREATE INDEX `alerts_expiry_updated_idx` ON `alerts` (`expires_at`,`updated_at`);--> statement-breakpoint
ALTER TABLE `collection_runs` ADD `discovery_segment_id` text;--> statement-breakpoint
CREATE INDEX `collection_runs_segment_attempt_idx` ON `collection_runs` (`discovery_segment_id`,`attempted_at`);--> statement-breakpoint
CREATE TABLE `__new_source_configurations` (
	`id` text PRIMARY KEY NOT NULL,
	`source` text NOT NULL,
	`market` text NOT NULL,
	`display_name` text NOT NULL,
	`discovery_url` text NOT NULL,
	`category` text DEFAULT 'Général' NOT NULL,
	`enabled` integer DEFAULT true NOT NULL,
	`cadence_minutes` integer DEFAULT 60 NOT NULL,
	`volatility_score` integer DEFAULT 50 NOT NULL,
	`last_run_at` text,
	`last_success_at` text,
	`products_seen` integer DEFAULT 0 NOT NULL,
	`duplicate_urls` integer DEFAULT 0 NOT NULL,
	`paused_reason` text,
	`circuit_state` text DEFAULT 'closed' NOT NULL,
	`failure_streak` integer DEFAULT 0 NOT NULL,
	`anti_bot_streak` integer DEFAULT 0 NOT NULL,
	`circuit_opened_at` text,
	`cooldown_until` text,
	`last_error_code` text,
	`daily_product_budget` integer DEFAULT 500 NOT NULL,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	`updated_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	CONSTRAINT "source_config_cadence_range" CHECK("cadence_minutes" BETWEEN 15 AND 1440),
	CONSTRAINT "source_config_volatility_range" CHECK("volatility_score" BETWEEN 0 AND 100),
	CONSTRAINT "source_config_products_nonnegative" CHECK("products_seen" >= 0),
	CONSTRAINT "source_config_duplicates_nonnegative" CHECK("duplicate_urls" >= 0),
	CONSTRAINT "source_config_circuit_allowed" CHECK("circuit_state" IN ('closed', 'open', 'half_open')),
	CONSTRAINT "source_config_failure_nonnegative" CHECK("failure_streak" >= 0),
	CONSTRAINT "source_config_antibot_nonnegative" CHECK("anti_bot_streak" >= 0),
	CONSTRAINT "source_config_daily_budget_range" CHECK("daily_product_budget" BETWEEN 1 AND 100000)
);
--> statement-breakpoint
INSERT INTO `__new_source_configurations`("id", "source", "market", "display_name", "discovery_url", "category", "enabled", "cadence_minutes", "volatility_score", "last_run_at", "last_success_at", "products_seen", "duplicate_urls", "paused_reason", "circuit_state", "failure_streak", "anti_bot_streak", "circuit_opened_at", "cooldown_until", "last_error_code", "daily_product_budget", "created_at", "updated_at") SELECT "id", "source", "market", "display_name", "discovery_url", "category", "enabled", "cadence_minutes", "volatility_score", "last_run_at", "last_success_at", "products_seen", "duplicate_urls", "paused_reason", 'closed', 0, 0, NULL, NULL, NULL, 500, "created_at", "updated_at" FROM `source_configurations`;--> statement-breakpoint
DROP TABLE `source_configurations`;--> statement-breakpoint
ALTER TABLE `__new_source_configurations` RENAME TO `source_configurations`;--> statement-breakpoint
CREATE UNIQUE INDEX `source_config_source_market_url_unique` ON `source_configurations` (`source`,`market`,`discovery_url`);--> statement-breakpoint
CREATE INDEX `source_config_enabled_due_idx` ON `source_configurations` (`enabled`,`last_run_at`);--> statement-breakpoint
CREATE TABLE `__new_user_preferences` (
	`owner_id` text PRIMARY KEY NOT NULL,
	`min_score` integer DEFAULT 75 NOT NULL,
	`quiet_hours` integer DEFAULT false NOT NULL,
	`quiet_start` text DEFAULT '22:00' NOT NULL,
	`quiet_end` text DEFAULT '08:00' NOT NULL,
	`timezone` text DEFAULT 'Europe/Paris' NOT NULL,
	`notification_enabled` integer DEFAULT true NOT NULL,
	`min_discount` integer DEFAULT 20 NOT NULL,
	`max_price_cents` integer,
	`markets_json` text DEFAULT '[]' NOT NULL,
	`categories_json` text DEFAULT '[]' NOT NULL,
	`sources_json` text DEFAULT '[]' NOT NULL,
	`delivery_country` text DEFAULT 'FR' NOT NULL,
	`postal_code` text,
	`delivery_mode` text DEFAULT 'either' NOT NULL,
	`require_location_match` integer DEFAULT false NOT NULL,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	`updated_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	CONSTRAINT "user_preferences_min_score_range" CHECK("min_score" BETWEEN 60 AND 95),
	CONSTRAINT "user_preferences_min_discount_range" CHECK("min_discount" BETWEEN 0 AND 90),
	CONSTRAINT "user_preferences_max_price_positive" CHECK("max_price_cents" > 0),
	CONSTRAINT "user_preferences_delivery_country_format" CHECK(length("delivery_country") = 2),
	CONSTRAINT "user_preferences_delivery_mode_allowed" CHECK("delivery_mode" IN ('home', 'pickup', 'either'))
);
--> statement-breakpoint
INSERT INTO `__new_user_preferences`("owner_id", "min_score", "quiet_hours", "quiet_start", "quiet_end", "timezone", "notification_enabled", "min_discount", "max_price_cents", "markets_json", "categories_json", "sources_json", "delivery_country", "postal_code", "delivery_mode", "require_location_match", "created_at", "updated_at") SELECT "owner_id", "min_score", "quiet_hours", "quiet_start", "quiet_end", "timezone", "notification_enabled", "min_discount", "max_price_cents", "markets_json", "categories_json", "sources_json", 'FR', NULL, 'either', false, "created_at", "updated_at" FROM `user_preferences`;--> statement-breakpoint
DROP TABLE `user_preferences`;--> statement-breakpoint
ALTER TABLE `__new_user_preferences` RENAME TO `user_preferences`;
