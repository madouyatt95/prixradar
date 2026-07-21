CREATE TABLE `alerts` (
	`id` text PRIMARY KEY NOT NULL,
	`source` text NOT NULL,
	`source_mode` text NOT NULL,
	`merchant` text NOT NULL,
	`market` text NOT NULL,
	`product_id` text NOT NULL,
	`title` text NOT NULL,
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
	`evidence_json` text DEFAULT '{}' NOT NULL,
	`observed_at` text NOT NULL,
	`verified_at` text,
	`expires_at` text,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	`updated_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	CONSTRAINT "alerts_price_nonnegative" CHECK("alerts"."price_cents" >= 0),
	CONSTRAINT "alerts_usual_price_positive" CHECK("alerts"."usual_price_cents" > 0),
	CONSTRAINT "alerts_source_allowed" CHECK("alerts"."source" IN ('amazon', 'boulanger', 'cdiscount', 'darty')),
	CONSTRAINT "alerts_source_mode_allowed" CHECK("alerts"."source_mode" IN ('live', 'demo', 'fixture')),
	CONSTRAINT "alerts_confidence_allowed" CHECK("alerts"."confidence" IN ('very_likely', 'likely', 'review', 'insufficient')),
	CONSTRAINT "alerts_status_allowed" CHECK("alerts"."status" IN ('active', 'review', 'monitoring', 'expired')),
	CONSTRAINT "alerts_shipping_nonnegative" CHECK("alerts"."shipping_cents" >= 0),
	CONSTRAINT "alerts_discount_percent_range" CHECK("alerts"."discount_percent" BETWEEN 0 AND 100),
	CONSTRAINT "alerts_score_range" CHECK("alerts"."score" BETWEEN 0 AND 100)
);
--> statement-breakpoint
CREATE INDEX `alerts_status_score_observed_idx` ON `alerts` (`status`,`score`,`observed_at`);--> statement-breakpoint
CREATE INDEX `alerts_source_market_product_idx` ON `alerts` (`source`,`market`,`product_id`);--> statement-breakpoint
CREATE INDEX `alerts_expiry_updated_idx` ON `alerts` (`expires_at`,`updated_at`);--> statement-breakpoint
CREATE TABLE `ingest_events` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`idempotency_key` text NOT NULL,
	`source` text NOT NULL,
	`event_type` text NOT NULL,
	`payload_hash` text NOT NULL,
	`accepted` integer DEFAULT true NOT NULL,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	CONSTRAINT "ingest_events_type_allowed" CHECK("ingest_events"."event_type" IN ('alert_upsert', 'source_status'))
);
--> statement-breakpoint
CREATE UNIQUE INDEX `ingest_events_idempotency_key_unique` ON `ingest_events` (`idempotency_key`);--> statement-breakpoint
CREATE INDEX `ingest_events_source_created_idx` ON `ingest_events` (`source`,`created_at`);--> statement-breakpoint
CREATE INDEX `ingest_events_created_idx` ON `ingest_events` (`created_at`);--> statement-breakpoint
CREATE TABLE `keepa_cache` (
	`id` text PRIMARY KEY NOT NULL,
	`market` text NOT NULL,
	`asin` text NOT NULL,
	`response_json` text NOT NULL,
	`fetched_at` text NOT NULL,
	`expires_at` text NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `keepa_cache_market_asin_unique` ON `keepa_cache` (`market`,`asin`);--> statement-breakpoint
CREATE INDEX `keepa_cache_expires_idx` ON `keepa_cache` (`expires_at`);--> statement-breakpoint
CREATE TABLE `keepa_usage` (
	`id` text PRIMARY KEY NOT NULL,
	`owner_id` text NOT NULL,
	`window_start` text NOT NULL,
	`requests` integer DEFAULT 0 NOT NULL,
	`updated_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	CONSTRAINT "keepa_usage_requests_nonnegative" CHECK("keepa_usage"."requests" >= 0)
);
--> statement-breakpoint
CREATE UNIQUE INDEX `keepa_usage_owner_window_unique` ON `keepa_usage` (`owner_id`,`window_start`);--> statement-breakpoint
CREATE INDEX `keepa_usage_window_idx` ON `keepa_usage` (`window_start`);--> statement-breakpoint
CREATE TABLE `notification_deliveries` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`alert_id` text NOT NULL,
	`subscription_id` integer NOT NULL,
	`owner_id` text NOT NULL,
	`channel` text NOT NULL,
	`status` text NOT NULL,
	`dedupe_key` text NOT NULL,
	`attempted_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	`sent_at` text,
	`error_code` text,
	FOREIGN KEY (`subscription_id`) REFERENCES `push_subscriptions`(`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "notification_deliveries_channel_allowed" CHECK("notification_deliveries"."channel" IN ('web_push')),
	CONSTRAINT "notification_deliveries_status_allowed" CHECK("notification_deliveries"."status" IN ('reserved', 'sent', 'failed', 'suppressed'))
);
--> statement-breakpoint
CREATE UNIQUE INDEX `notification_deliveries_dedupe_key_unique` ON `notification_deliveries` (`dedupe_key`);--> statement-breakpoint
CREATE INDEX `notification_deliveries_owner_alert_idx` ON `notification_deliveries` (`owner_id`,`alert_id`);--> statement-breakpoint
CREATE INDEX `notification_deliveries_attempted_idx` ON `notification_deliveries` (`attempted_at`);--> statement-breakpoint
CREATE TABLE `price_observations` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`alert_id` text NOT NULL,
	`price_cents` integer NOT NULL,
	`shipping_cents` integer,
	`total_cents` integer,
	`available` integer DEFAULT true NOT NULL,
	`observed_at` text NOT NULL,
	`raw_hash` text NOT NULL,
	FOREIGN KEY (`alert_id`) REFERENCES `alerts`(`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "observations_price_nonnegative" CHECK("price_observations"."price_cents" >= 0),
	CONSTRAINT "observations_shipping_nonnegative" CHECK("price_observations"."shipping_cents" >= 0),
	CONSTRAINT "observations_total_nonnegative" CHECK("price_observations"."total_cents" >= 0),
	CONSTRAINT "observations_total_consistent" CHECK(("price_observations"."shipping_cents" IS NULL AND "price_observations"."total_cents" IS NULL) OR ("price_observations"."shipping_cents" IS NOT NULL AND "price_observations"."total_cents" = "price_observations"."price_cents" + "price_observations"."shipping_cents"))
);
--> statement-breakpoint
CREATE UNIQUE INDEX `observations_alert_raw_hash_unique` ON `price_observations` (`alert_id`,`raw_hash`);--> statement-breakpoint
CREATE INDEX `observations_alert_observed_idx` ON `price_observations` (`alert_id`,`observed_at`);--> statement-breakpoint
CREATE INDEX `observations_observed_idx` ON `price_observations` (`observed_at`);--> statement-breakpoint
CREATE TABLE `push_subscriptions` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`owner_id` text NOT NULL,
	`endpoint` text NOT NULL,
	`p256dh` text NOT NULL,
	`auth` text NOT NULL,
	`content_encoding` text DEFAULT 'aes128gcm' NOT NULL,
	`enabled` integer DEFAULT true NOT NULL,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	`updated_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	CONSTRAINT "push_subscriptions_encoding_allowed" CHECK("push_subscriptions"."content_encoding" IN ('aes128gcm', 'aesgcm'))
);
--> statement-breakpoint
CREATE UNIQUE INDEX `push_subscriptions_owner_endpoint_unique` ON `push_subscriptions` (`owner_id`,`endpoint`);--> statement-breakpoint
CREATE INDEX `push_subscriptions_enabled_owner_idx` ON `push_subscriptions` (`enabled`,`owner_id`);--> statement-breakpoint
CREATE INDEX `push_subscriptions_enabled_updated_idx` ON `push_subscriptions` (`enabled`,`updated_at`);--> statement-breakpoint
CREATE TABLE `source_statuses` (
	`id` text PRIMARY KEY NOT NULL,
	`source` text NOT NULL,
	`market` text NOT NULL,
	`display_name` text NOT NULL,
	`mode` text NOT NULL,
	`status` text NOT NULL,
	`last_success_at` text,
	`last_attempt_at` text,
	`last_error_code` text,
	`products_seen` integer DEFAULT 0 NOT NULL,
	`queue_lag` integer DEFAULT 0 NOT NULL,
	`updated_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	CONSTRAINT "source_statuses_products_seen_nonnegative" CHECK("source_statuses"."products_seen" >= 0),
	CONSTRAINT "source_statuses_queue_lag_nonnegative" CHECK("source_statuses"."queue_lag" >= 0),
	CONSTRAINT "source_statuses_mode_allowed" CHECK("source_statuses"."mode" IN ('live', 'demo', 'fixture')),
	CONSTRAINT "source_statuses_status_allowed" CHECK("source_statuses"."status" IN ('healthy', 'degraded', 'offline', 'not_configured'))
);
--> statement-breakpoint
CREATE UNIQUE INDEX `source_statuses_source_market_unique` ON `source_statuses` (`source`,`market`);--> statement-breakpoint
CREATE INDEX `source_statuses_status_updated_idx` ON `source_statuses` (`status`,`updated_at`);--> statement-breakpoint
CREATE TABLE `user_preferences` (
	`owner_id` text PRIMARY KEY NOT NULL,
	`min_score` integer DEFAULT 75 NOT NULL,
	`quiet_hours` integer DEFAULT false NOT NULL,
	`quiet_start` text DEFAULT '22:00' NOT NULL,
	`quiet_end` text DEFAULT '08:00' NOT NULL,
	`timezone` text DEFAULT 'Europe/Paris' NOT NULL,
	`notification_enabled` integer DEFAULT true NOT NULL,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	`updated_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	CONSTRAINT "user_preferences_min_score_range" CHECK("user_preferences"."min_score" BETWEEN 60 AND 95)
);
