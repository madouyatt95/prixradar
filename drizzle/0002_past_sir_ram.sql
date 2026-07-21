CREATE TABLE `alert_feedback` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`alert_id` text NOT NULL,
	`owner_id` text NOT NULL,
	`verdict` text NOT NULL,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	`updated_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	FOREIGN KEY (`alert_id`) REFERENCES `alerts`(`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "alert_feedback_verdict_allowed" CHECK("alert_feedback"."verdict" IN ('useful', 'false_positive', 'expired'))
);
--> statement-breakpoint
CREATE UNIQUE INDEX `alert_feedback_owner_alert_unique` ON `alert_feedback` (`owner_id`,`alert_id`);--> statement-breakpoint
CREATE INDEX `alert_feedback_alert_verdict_idx` ON `alert_feedback` (`alert_id`,`verdict`);--> statement-breakpoint
CREATE TABLE `collection_runs` (
	`id` text PRIMARY KEY NOT NULL,
	`source` text NOT NULL,
	`market` text NOT NULL,
	`status` text NOT NULL,
	`products_seen` integer DEFAULT 0 NOT NULL,
	`queue_lag` integer DEFAULT 0 NOT NULL,
	`duplicates_skipped` integer DEFAULT 0 NOT NULL,
	`anti_bot_blocked` integer DEFAULT false NOT NULL,
	`keepa_requests` integer DEFAULT 0 NOT NULL,
	`apify_cost_micros` integer,
	`error_code` text,
	`attempted_at` text NOT NULL,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	CONSTRAINT "collection_runs_products_nonnegative" CHECK("collection_runs"."products_seen" >= 0),
	CONSTRAINT "collection_runs_queue_nonnegative" CHECK("collection_runs"."queue_lag" >= 0),
	CONSTRAINT "collection_runs_duplicates_nonnegative" CHECK("collection_runs"."duplicates_skipped" >= 0),
	CONSTRAINT "collection_runs_keepa_nonnegative" CHECK("collection_runs"."keepa_requests" >= 0),
	CONSTRAINT "collection_runs_cost_nonnegative" CHECK("collection_runs"."apify_cost_micros" >= 0)
);
--> statement-breakpoint
CREATE INDEX `collection_runs_source_attempt_idx` ON `collection_runs` (`source`,`attempted_at`);--> statement-breakpoint
CREATE INDEX `collection_runs_attempt_idx` ON `collection_runs` (`attempted_at`);--> statement-breakpoint
CREATE TABLE `privacy_consents` (
	`owner_id` text PRIMARY KEY NOT NULL,
	`analytics` integer DEFAULT false NOT NULL,
	`affiliate_links` integer DEFAULT false NOT NULL,
	`policy_version` text DEFAULT '2026-07' NOT NULL,
	`updated_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL
);
--> statement-breakpoint
CREATE TABLE `source_configurations` (
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
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	`updated_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	CONSTRAINT "source_config_cadence_range" CHECK("source_configurations"."cadence_minutes" BETWEEN 15 AND 1440),
	CONSTRAINT "source_config_volatility_range" CHECK("source_configurations"."volatility_score" BETWEEN 0 AND 100),
	CONSTRAINT "source_config_products_nonnegative" CHECK("source_configurations"."products_seen" >= 0),
	CONSTRAINT "source_config_duplicates_nonnegative" CHECK("source_configurations"."duplicate_urls" >= 0)
);
--> statement-breakpoint
CREATE UNIQUE INDEX `source_config_source_market_url_unique` ON `source_configurations` (`source`,`market`,`discovery_url`);--> statement-breakpoint
CREATE INDEX `source_config_enabled_due_idx` ON `source_configurations` (`enabled`,`last_run_at`);--> statement-breakpoint
PRAGMA foreign_keys=OFF;--> statement-breakpoint
CREATE TABLE `__new_alerts` (
	`id` text PRIMARY KEY NOT NULL,
	`source` text NOT NULL,
	`source_mode` text NOT NULL,
	`merchant` text NOT NULL,
	`market` text NOT NULL,
	`product_id` text NOT NULL,
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
	`evidence_json` text DEFAULT '{}' NOT NULL,
	`observed_at` text NOT NULL,
	`verified_at` text,
	`expires_at` text,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	`updated_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	CONSTRAINT "alerts_price_nonnegative" CHECK("price_cents" >= 0),
	CONSTRAINT "alerts_usual_price_positive" CHECK("usual_price_cents" > 0),
	CONSTRAINT "alerts_source_allowed" CHECK("source" IN ('amazon', 'boulanger', 'cdiscount', 'darty')),
	CONSTRAINT "alerts_source_mode_allowed" CHECK("source_mode" IN ('live', 'demo', 'fixture')),
	CONSTRAINT "alerts_confidence_allowed" CHECK("confidence" IN ('very_likely', 'likely', 'review', 'insufficient')),
	CONSTRAINT "alerts_status_allowed" CHECK("status" IN ('active', 'review', 'monitoring', 'expired')),
	CONSTRAINT "alerts_shipping_nonnegative" CHECK("shipping_cents" >= 0),
	CONSTRAINT "alerts_public_price_nonnegative" CHECK("public_price_cents" >= 0),
	CONSTRAINT "alerts_promotion_type_allowed" CHECK("promotion_type" IN ('public_price', 'coupon', 'membership', 'cashback', 'trade_in', 'bundle', 'unknown')),
	CONSTRAINT "alerts_discount_percent_range" CHECK("discount_percent" BETWEEN 0 AND 100),
	CONSTRAINT "alerts_score_range" CHECK("score" BETWEEN 0 AND 100)
);
--> statement-breakpoint
INSERT INTO `__new_alerts`("id", "source", "source_mode", "merchant", "market", "product_id", "identity_key", "title", "brand", "model", "gtin", "category", "url", "currency", "price_cents", "usual_price_cents", "discount_percent", "score", "confidence", "status", "seller", "condition", "shipping_cents", "public_price_cents", "price_accessible_to_all", "promotion_type", "promotion_label", "evidence_json", "observed_at", "verified_at", "expires_at", "created_at", "updated_at") SELECT "id", "source", "source_mode", "merchant", "market", "product_id", NULL, "title", NULL, NULL, NULL, NULL, "url", "currency", "price_cents", "usual_price_cents", "discount_percent", "score", "confidence", "status", "seller", "condition", "shipping_cents", CASE WHEN "shipping_cents" IS NULL THEN NULL ELSE "price_cents" + "shipping_cents" END, true, 'public_price', NULL, "evidence_json", "observed_at", "verified_at", "expires_at", "created_at", "updated_at" FROM `alerts`;--> statement-breakpoint
DROP TABLE `alerts`;--> statement-breakpoint
ALTER TABLE `__new_alerts` RENAME TO `alerts`;--> statement-breakpoint
PRAGMA foreign_keys=ON;--> statement-breakpoint
CREATE INDEX `alerts_status_score_observed_idx` ON `alerts` (`status`,`score`,`observed_at`);--> statement-breakpoint
CREATE INDEX `alerts_source_market_product_idx` ON `alerts` (`source`,`market`,`product_id`);--> statement-breakpoint
CREATE INDEX `alerts_identity_observed_idx` ON `alerts` (`identity_key`,`observed_at`);--> statement-breakpoint
CREATE INDEX `alerts_category_price_idx` ON `alerts` (`category`,`public_price_cents`);--> statement-breakpoint
CREATE INDEX `alerts_expiry_updated_idx` ON `alerts` (`expires_at`,`updated_at`);--> statement-breakpoint
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
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	`updated_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	CONSTRAINT "user_preferences_min_score_range" CHECK("min_score" BETWEEN 60 AND 95),
	CONSTRAINT "user_preferences_min_discount_range" CHECK("min_discount" BETWEEN 0 AND 90),
	CONSTRAINT "user_preferences_max_price_positive" CHECK("max_price_cents" > 0)
);
--> statement-breakpoint
INSERT INTO `__new_user_preferences`("owner_id", "min_score", "quiet_hours", "quiet_start", "quiet_end", "timezone", "notification_enabled", "min_discount", "max_price_cents", "markets_json", "categories_json", "sources_json", "created_at", "updated_at") SELECT "owner_id", "min_score", "quiet_hours", "quiet_start", "quiet_end", "timezone", "notification_enabled", 20, NULL, '[]', '[]', '[]', "created_at", "updated_at" FROM `user_preferences`;--> statement-breakpoint
DROP TABLE `user_preferences`;--> statement-breakpoint
ALTER TABLE `__new_user_preferences` RENAME TO `user_preferences`;
