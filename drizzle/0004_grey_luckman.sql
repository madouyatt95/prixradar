CREATE TABLE `radar_rules` (
	`id` text PRIMARY KEY NOT NULL,
	`owner_id` text NOT NULL,
	`name` text NOT NULL,
	`query` text NOT NULL,
	`intent_json` text NOT NULL,
	`enabled` integer DEFAULT true NOT NULL,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	`updated_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL
);
--> statement-breakpoint
CREATE INDEX `radar_rules_owner_enabled_idx` ON `radar_rules` (`owner_id`,`enabled`);--> statement-breakpoint
CREATE INDEX `radar_rules_updated_idx` ON `radar_rules` (`updated_at`);--> statement-breakpoint
CREATE TABLE `recheck_requests` (
	`id` text PRIMARY KEY NOT NULL,
	`alert_id` text NOT NULL,
	`owner_id` text NOT NULL,
	`source` text NOT NULL,
	`market` text NOT NULL,
	`url` text NOT NULL,
	`status` text DEFAULT 'pending' NOT NULL,
	`result_json` text DEFAULT '{}' NOT NULL,
	`requested_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	`claimed_at` text,
	`completed_at` text,
	`updated_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	FOREIGN KEY (`alert_id`) REFERENCES `alerts`(`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "recheck_requests_status_allowed" CHECK("recheck_requests"."status" IN ('pending', 'processing', 'completed', 'failed'))
);
--> statement-breakpoint
CREATE INDEX `recheck_requests_status_requested_idx` ON `recheck_requests` (`status`,`requested_at`);--> statement-breakpoint
CREATE INDEX `recheck_requests_owner_updated_idx` ON `recheck_requests` (`owner_id`,`updated_at`);--> statement-breakpoint
CREATE INDEX `recheck_requests_alert_status_idx` ON `recheck_requests` (`alert_id`,`status`);--> statement-breakpoint
PRAGMA foreign_keys=OFF;--> statement-breakpoint
CREATE TABLE `__new_alert_feedback` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`alert_id` text NOT NULL,
	`owner_id` text NOT NULL,
	`verdict` text NOT NULL,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	`updated_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	FOREIGN KEY (`alert_id`) REFERENCES `alerts`(`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "alert_feedback_verdict_allowed" CHECK("verdict" IN ('useful', 'false_positive', 'expired', 'purchased', 'cancelled', 'wrong_variant', 'coupon_failed', 'price_confirmed'))
);
--> statement-breakpoint
INSERT INTO `__new_alert_feedback`("id", "alert_id", "owner_id", "verdict", "created_at", "updated_at") SELECT "id", "alert_id", "owner_id", "verdict", "created_at", "updated_at" FROM `alert_feedback`;--> statement-breakpoint
DROP TABLE `alert_feedback`;--> statement-breakpoint
ALTER TABLE `__new_alert_feedback` RENAME TO `alert_feedback`;--> statement-breakpoint
CREATE UNIQUE INDEX `alert_feedback_owner_alert_unique` ON `alert_feedback` (`owner_id`,`alert_id`);--> statement-breakpoint
CREATE INDEX `alert_feedback_alert_verdict_idx` ON `alert_feedback` (`alert_id`,`verdict`);--> statement-breakpoint
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
	`buy_now_score` integer DEFAULT 0 NOT NULL,
	`buy_now_json` text DEFAULT '{}' NOT NULL,
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
	CONSTRAINT "alerts_score_range" CHECK("score" BETWEEN 0 AND 100),
	CONSTRAINT "alerts_buy_now_score_range" CHECK("buy_now_score" BETWEEN 0 AND 100)
);
--> statement-breakpoint
INSERT INTO `__new_alerts`("id", "source", "source_mode", "merchant", "market", "product_id", "canonical_product_id", "identity_key", "title", "brand", "model", "gtin", "category", "url", "currency", "price_cents", "usual_price_cents", "discount_percent", "score", "buy_now_score", "buy_now_json", "confidence", "status", "seller", "condition", "shipping_cents", "public_price_cents", "price_accessible_to_all", "promotion_type", "promotion_label", "delivery_country", "delivery_postal_prefix", "delivery_mode", "location_verified", "evidence_json", "observed_at", "verified_at", "expires_at", "created_at", "updated_at") SELECT "id", "source", "source_mode", "merchant", "market", "product_id", "canonical_product_id", "identity_key", "title", "brand", "model", "gtin", "category", "url", "currency", "price_cents", "usual_price_cents", "discount_percent", "score", 0, '{}', "confidence", "status", "seller", "condition", "shipping_cents", "public_price_cents", "price_accessible_to_all", "promotion_type", "promotion_label", "delivery_country", "delivery_postal_prefix", "delivery_mode", "location_verified", "evidence_json", "observed_at", "verified_at", "expires_at", "created_at", "updated_at" FROM `alerts`;--> statement-breakpoint
DROP TABLE `alerts`;--> statement-breakpoint
ALTER TABLE `__new_alerts` RENAME TO `alerts`;--> statement-breakpoint
CREATE INDEX `alerts_status_score_observed_idx` ON `alerts` (`status`,`score`,`observed_at`);--> statement-breakpoint
CREATE INDEX `alerts_source_market_product_idx` ON `alerts` (`source`,`market`,`product_id`);--> statement-breakpoint
CREATE INDEX `alerts_identity_observed_idx` ON `alerts` (`identity_key`,`observed_at`);--> statement-breakpoint
CREATE INDEX `alerts_canonical_observed_idx` ON `alerts` (`canonical_product_id`,`observed_at`);--> statement-breakpoint
CREATE INDEX `alerts_category_price_idx` ON `alerts` (`category`,`public_price_cents`);--> statement-breakpoint
CREATE INDEX `alerts_expiry_updated_idx` ON `alerts` (`expires_at`,`updated_at`);--> statement-breakpoint
CREATE TABLE `__new_notification_deliveries` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`alert_id` text NOT NULL,
	`subscription_id` integer NOT NULL,
	`owner_id` text NOT NULL,
	`channel` text NOT NULL,
	`tier` text DEFAULT 'personal' NOT NULL,
	`status` text NOT NULL,
	`dedupe_key` text NOT NULL,
	`attempted_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	`sent_at` text,
	`error_code` text,
	FOREIGN KEY (`subscription_id`) REFERENCES `push_subscriptions`(`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "notification_deliveries_channel_allowed" CHECK("channel" IN ('web_push')),
	CONSTRAINT "notification_deliveries_status_allowed" CHECK("status" IN ('reserved', 'sent', 'failed', 'suppressed')),
	CONSTRAINT "notification_deliveries_tier_allowed" CHECK("tier" IN ('urgent', 'personal', 'digest'))
);
--> statement-breakpoint
INSERT INTO `__new_notification_deliveries`("id", "alert_id", "subscription_id", "owner_id", "channel", "tier", "status", "dedupe_key", "attempted_at", "sent_at", "error_code") SELECT "id", "alert_id", "subscription_id", "owner_id", "channel", 'personal', "status", "dedupe_key", "attempted_at", "sent_at", "error_code" FROM `notification_deliveries`;--> statement-breakpoint
DROP TABLE `notification_deliveries`;--> statement-breakpoint
ALTER TABLE `__new_notification_deliveries` RENAME TO `notification_deliveries`;--> statement-breakpoint
CREATE UNIQUE INDEX `notification_deliveries_dedupe_key_unique` ON `notification_deliveries` (`dedupe_key`);--> statement-breakpoint
CREATE INDEX `notification_deliveries_owner_alert_idx` ON `notification_deliveries` (`owner_id`,`alert_id`);--> statement-breakpoint
CREATE INDEX `notification_deliveries_attempted_idx` ON `notification_deliveries` (`attempted_at`);--> statement-breakpoint
CREATE TABLE `__new_user_preferences` (
	`owner_id` text PRIMARY KEY NOT NULL,
	`min_score` integer DEFAULT 75 NOT NULL,
	`quiet_hours` integer DEFAULT false NOT NULL,
	`quiet_start` text DEFAULT '22:00' NOT NULL,
	`quiet_end` text DEFAULT '08:00' NOT NULL,
	`timezone` text DEFAULT 'Europe/Paris' NOT NULL,
	`notification_enabled` integer DEFAULT true NOT NULL,
	`notification_speed` text DEFAULT 'balanced' NOT NULL,
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
	CONSTRAINT "user_preferences_delivery_mode_allowed" CHECK("delivery_mode" IN ('home', 'pickup', 'either')),
	CONSTRAINT "user_preferences_notification_speed_allowed" CHECK("notification_speed" IN ('instant', 'balanced', 'digest'))
);
--> statement-breakpoint
INSERT INTO `__new_user_preferences`("owner_id", "min_score", "quiet_hours", "quiet_start", "quiet_end", "timezone", "notification_enabled", "notification_speed", "min_discount", "max_price_cents", "markets_json", "categories_json", "sources_json", "delivery_country", "postal_code", "delivery_mode", "require_location_match", "created_at", "updated_at") SELECT "owner_id", "min_score", "quiet_hours", "quiet_start", "quiet_end", "timezone", "notification_enabled", 'balanced', "min_discount", "max_price_cents", "markets_json", "categories_json", "sources_json", "delivery_country", "postal_code", "delivery_mode", "require_location_match", "created_at", "updated_at" FROM `user_preferences`;--> statement-breakpoint
DROP TABLE `user_preferences`;--> statement-breakpoint
ALTER TABLE `__new_user_preferences` RENAME TO `user_preferences`;--> statement-breakpoint
PRAGMA foreign_keys=ON;
