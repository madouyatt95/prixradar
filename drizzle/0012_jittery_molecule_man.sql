PRAGMA defer_foreign_keys=ON;--> statement-breakpoint
CREATE TABLE `__backup_price_observations_0012` AS SELECT * FROM `price_observations`;--> statement-breakpoint
CREATE TABLE `__backup_alert_intelligence_0012` AS SELECT * FROM `alert_intelligence`;--> statement-breakpoint
CREATE TABLE `__backup_alert_feedback_0012` AS SELECT * FROM `alert_feedback`;--> statement-breakpoint
CREATE TABLE `__backup_recheck_requests_0012` AS SELECT * FROM `recheck_requests`;--> statement-breakpoint
CREATE TABLE `__backup_mission_items_0012` AS SELECT `id`, `selected_alert_id` FROM `mission_items`;--> statement-breakpoint
CREATE TABLE `__backup_purchases_0012` AS SELECT `id`, `alert_id` FROM `purchases`;--> statement-breakpoint
CREATE TABLE `__backup_ean_scan_requests_0012` AS SELECT `id`, `matched_alert_id` FROM `ean_scan_requests`;--> statement-breakpoint
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
	CONSTRAINT "alerts_source_allowed" CHECK("source" IN ('amazon', 'boulanger', 'carrefour', 'castorama', 'cdiscount', 'conforama', 'darty', 'fnac', 'jd_sports', 'leroy_merlin', 'rueducommerce')),
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
INSERT INTO `__new_alerts`("id", "source", "source_mode", "merchant", "market", "product_id", "canonical_product_id", "identity_key", "title", "brand", "model", "gtin", "category", "url", "currency", "price_cents", "usual_price_cents", "discount_percent", "score", "buy_now_score", "buy_now_json", "confidence", "status", "seller", "condition", "shipping_cents", "public_price_cents", "price_accessible_to_all", "promotion_type", "promotion_label", "delivery_country", "delivery_postal_prefix", "delivery_mode", "location_verified", "evidence_json", "observed_at", "verified_at", "expires_at", "created_at", "updated_at") SELECT "id", "source", "source_mode", "merchant", "market", "product_id", "canonical_product_id", "identity_key", "title", "brand", "model", "gtin", "category", "url", "currency", "price_cents", "usual_price_cents", "discount_percent", "score", "buy_now_score", "buy_now_json", "confidence", "status", "seller", "condition", "shipping_cents", "public_price_cents", "price_accessible_to_all", "promotion_type", "promotion_label", "delivery_country", "delivery_postal_prefix", "delivery_mode", "location_verified", "evidence_json", "observed_at", "verified_at", "expires_at", "created_at", "updated_at" FROM `alerts`;--> statement-breakpoint
DROP TABLE `alerts`;--> statement-breakpoint
ALTER TABLE `__new_alerts` RENAME TO `alerts`;--> statement-breakpoint
INSERT OR REPLACE INTO `price_observations` SELECT * FROM `__backup_price_observations_0012`;--> statement-breakpoint
INSERT OR REPLACE INTO `alert_intelligence` SELECT * FROM `__backup_alert_intelligence_0012`;--> statement-breakpoint
INSERT OR REPLACE INTO `alert_feedback` SELECT * FROM `__backup_alert_feedback_0012`;--> statement-breakpoint
INSERT OR REPLACE INTO `recheck_requests` SELECT * FROM `__backup_recheck_requests_0012`;--> statement-breakpoint
UPDATE `mission_items` SET `selected_alert_id` = (SELECT `selected_alert_id` FROM `__backup_mission_items_0012` WHERE `__backup_mission_items_0012`.`id` = `mission_items`.`id`) WHERE `id` IN (SELECT `id` FROM `__backup_mission_items_0012`);--> statement-breakpoint
UPDATE `purchases` SET `alert_id` = (SELECT `alert_id` FROM `__backup_purchases_0012` WHERE `__backup_purchases_0012`.`id` = `purchases`.`id`) WHERE `id` IN (SELECT `id` FROM `__backup_purchases_0012`);--> statement-breakpoint
UPDATE `ean_scan_requests` SET `matched_alert_id` = (SELECT `matched_alert_id` FROM `__backup_ean_scan_requests_0012` WHERE `__backup_ean_scan_requests_0012`.`id` = `ean_scan_requests`.`id`) WHERE `id` IN (SELECT `id` FROM `__backup_ean_scan_requests_0012`);--> statement-breakpoint
DROP TABLE `__backup_price_observations_0012`;--> statement-breakpoint
DROP TABLE `__backup_alert_intelligence_0012`;--> statement-breakpoint
DROP TABLE `__backup_alert_feedback_0012`;--> statement-breakpoint
DROP TABLE `__backup_recheck_requests_0012`;--> statement-breakpoint
DROP TABLE `__backup_mission_items_0012`;--> statement-breakpoint
DROP TABLE `__backup_purchases_0012`;--> statement-breakpoint
DROP TABLE `__backup_ean_scan_requests_0012`;--> statement-breakpoint
CREATE INDEX `alerts_status_score_observed_idx` ON `alerts` (`status`,`score`,`observed_at`);--> statement-breakpoint
CREATE INDEX `alerts_source_market_product_idx` ON `alerts` (`source`,`market`,`product_id`);--> statement-breakpoint
CREATE INDEX `alerts_identity_observed_idx` ON `alerts` (`identity_key`,`observed_at`);--> statement-breakpoint
CREATE INDEX `alerts_canonical_observed_idx` ON `alerts` (`canonical_product_id`,`observed_at`);--> statement-breakpoint
CREATE INDEX `alerts_category_price_idx` ON `alerts` (`category`,`public_price_cents`);--> statement-breakpoint
CREATE INDEX `alerts_expiry_updated_idx` ON `alerts` (`expires_at`,`updated_at`);--> statement-breakpoint
CREATE TABLE `__new_inspection_requests` (
	`id` text PRIMARY KEY NOT NULL,
	`owner_id` text NOT NULL,
	`url` text NOT NULL,
	`source` text NOT NULL,
	`market` text NOT NULL,
	`status` text DEFAULT 'pending' NOT NULL,
	`result_json` text DEFAULT '{}' NOT NULL,
	`requested_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	`claimed_at` text,
	`completed_at` text,
	`updated_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	CONSTRAINT "inspection_requests_status_allowed" CHECK("status" IN ('pending', 'processing', 'completed', 'failed')),
	CONSTRAINT "inspection_requests_source_allowed" CHECK("source" IN ('amazon', 'boulanger', 'carrefour', 'castorama', 'cdiscount', 'conforama', 'darty', 'fnac', 'jd_sports', 'leroy_merlin', 'rueducommerce'))
);
--> statement-breakpoint
INSERT INTO `__new_inspection_requests`("id", "owner_id", "url", "source", "market", "status", "result_json", "requested_at", "claimed_at", "completed_at", "updated_at") SELECT "id", "owner_id", "url", "source", "market", "status", "result_json", "requested_at", "claimed_at", "completed_at", "updated_at" FROM `inspection_requests`;--> statement-breakpoint
DROP TABLE `inspection_requests`;--> statement-breakpoint
ALTER TABLE `__new_inspection_requests` RENAME TO `inspection_requests`;--> statement-breakpoint
CREATE INDEX `inspection_requests_status_requested_idx` ON `inspection_requests` (`status`,`requested_at`);--> statement-breakpoint
CREATE INDEX `inspection_requests_owner_updated_idx` ON `inspection_requests` (`owner_id`,`updated_at`);--> statement-breakpoint
CREATE INDEX `inspection_requests_url_status_idx` ON `inspection_requests` (`url`,`status`);--> statement-breakpoint
CREATE TABLE `__new_merchant_products` (
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
	CONSTRAINT "merchant_products_source_allowed" CHECK("source" IN ('amazon', 'boulanger', 'carrefour', 'castorama', 'cdiscount', 'conforama', 'darty', 'fnac', 'jd_sports', 'leroy_merlin', 'rueducommerce')),
	CONSTRAINT "merchant_products_method_allowed" CHECK("match_method" IN ('gtin', 'brand_model', 'identity', 'isolated', 'manual')),
	CONSTRAINT "merchant_products_review_allowed" CHECK("review_status" IN ('automatic', 'confirmed', 'needs_review', 'rejected')),
	CONSTRAINT "merchant_products_score_range" CHECK("match_score" BETWEEN 0 AND 100)
);
--> statement-breakpoint
INSERT INTO `__new_merchant_products`("id", "canonical_product_id", "source", "market", "external_id", "identity_key", "gtin", "title", "brand", "model", "url", "variant_key", "match_method", "match_score", "review_status", "last_seen_at", "created_at", "updated_at") SELECT "id", "canonical_product_id", "source", "market", "external_id", "identity_key", "gtin", "title", "brand", "model", "url", "variant_key", "match_method", "match_score", "review_status", "last_seen_at", "created_at", "updated_at" FROM `merchant_products`;--> statement-breakpoint
DROP TABLE `merchant_products`;--> statement-breakpoint
ALTER TABLE `__new_merchant_products` RENAME TO `merchant_products`;--> statement-breakpoint
CREATE UNIQUE INDEX `merchant_products_source_market_external_unique` ON `merchant_products` (`source`,`market`,`external_id`);--> statement-breakpoint
CREATE INDEX `merchant_products_canonical_idx` ON `merchant_products` (`canonical_product_id`);--> statement-breakpoint
CREATE INDEX `merchant_products_review_idx` ON `merchant_products` (`review_status`,`updated_at`);--> statement-breakpoint
CREATE INDEX `merchant_products_identity_idx` ON `merchant_products` (`identity_key`);
--> statement-breakpoint
INSERT OR IGNORE INTO `source_configurations` (`id`, `source`, `market`, `display_name`, `discovery_url`, `category`, `discovery_strategy`, `enabled`, `cadence_minutes`, `volatility_score`, `daily_product_budget`) VALUES
	('jd-sports-fr-chaussures', 'jd_sports', 'FR', 'JD Sports · Chaussures', 'https://www.jdsports.fr/c/chaussures/', 'Chaussures', 'links', 1, 240, 55, 72),
	('jd-sports-fr-vetements', 'jd_sports', 'FR', 'JD Sports · Vêtements', 'https://www.jdsports.fr/c/vtements/', 'Vêtements', 'links', 1, 240, 55, 72),
	('jd-sports-fr-accessoires', 'jd_sports', 'FR', 'JD Sports · Accessoires', 'https://www.jdsports.fr/c/accessoires/', 'Accessoires', 'links', 1, 240, 50, 72);--> statement-breakpoint
UPDATE `discovery_segments` SET `daily_token_budget` = min(100000, `daily_token_budget` * 5), `updated_at` = CURRENT_TIMESTAMP WHERE `market` = 'FR';--> statement-breakpoint
UPDATE `discovery_segments` SET `enabled` = 0, `updated_at` = CURRENT_TIMESTAMP WHERE `market` <> 'FR';--> statement-breakpoint
PRAGMA defer_foreign_keys=OFF;--> statement-breakpoint
PRAGMA foreign_key_check;
