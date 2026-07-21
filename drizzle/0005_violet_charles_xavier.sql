CREATE TABLE `alert_intelligence` (
	`alert_id` text PRIMARY KEY NOT NULL,
	`variant_fingerprint` text NOT NULL,
	`variant_json` text DEFAULT '{}' NOT NULL,
	`variant_confidence` integer DEFAULT 0 NOT NULL,
	`shadow_cart_status` text DEFAULT 'product_page' NOT NULL,
	`shadow_cart_json` text DEFAULT '{}' NOT NULL,
	`final_total_cents` integer,
	`price_index_cents` integer NOT NULL,
	`price_index_json` text DEFAULT '{}' NOT NULL,
	`market_position` text DEFAULT 'market' NOT NULL,
	`anomaly_kind` text DEFAULT 'insufficient_evidence' NOT NULL,
	`anomaly_json` text DEFAULT '{}' NOT NULL,
	`seller_score` integer DEFAULT 0 NOT NULL,
	`seller_json` text DEFAULT '{}' NOT NULL,
	`urgency_score` integer DEFAULT 0 NOT NULL,
	`predicted_lifetime_minutes` integer DEFAULT 0 NOT NULL,
	`predicted_expires_at` text,
	`updated_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	FOREIGN KEY (`alert_id`) REFERENCES `alerts`(`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "alert_intelligence_variant_confidence_range" CHECK("alert_intelligence"."variant_confidence" BETWEEN 0 AND 100),
	CONSTRAINT "alert_intelligence_seller_score_range" CHECK("alert_intelligence"."seller_score" BETWEEN 0 AND 100),
	CONSTRAINT "alert_intelligence_urgency_score_range" CHECK("alert_intelligence"."urgency_score" BETWEEN 0 AND 100),
	CONSTRAINT "alert_intelligence_lifetime_nonnegative" CHECK("alert_intelligence"."predicted_lifetime_minutes" >= 0),
	CONSTRAINT "alert_intelligence_total_nonnegative" CHECK("alert_intelligence"."final_total_cents" >= 0),
	CONSTRAINT "alert_intelligence_index_positive" CHECK("alert_intelligence"."price_index_cents" > 0),
	CONSTRAINT "alert_intelligence_cart_allowed" CHECK("alert_intelligence"."shadow_cart_status" IN ('confirmed', 'product_page', 'blocked', 'unavailable')),
	CONSTRAINT "alert_intelligence_position_allowed" CHECK("alert_intelligence"."market_position" IN ('best', 'below_market', 'market', 'above_market')),
	CONSTRAINT "alert_intelligence_kind_allowed" CHECK("alert_intelligence"."anomaly_kind" IN ('true_anomaly', 'promotion', 'wrong_variant', 'seller_risk', 'conditional_price', 'shipping_unknown', 'refurbished', 'insufficient_evidence'))
);
--> statement-breakpoint
CREATE INDEX `alert_intelligence_kind_score_idx` ON `alert_intelligence` (`anomaly_kind`,`urgency_score`);--> statement-breakpoint
CREATE INDEX `alert_intelligence_cart_updated_idx` ON `alert_intelligence` (`shadow_cart_status`,`updated_at`);--> statement-breakpoint
CREATE INDEX `alert_intelligence_variant_idx` ON `alert_intelligence` (`variant_fingerprint`);--> statement-breakpoint
CREATE TABLE `inspection_requests` (
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
	CONSTRAINT "inspection_requests_status_allowed" CHECK("inspection_requests"."status" IN ('pending', 'processing', 'completed', 'failed')),
	CONSTRAINT "inspection_requests_source_allowed" CHECK("inspection_requests"."source" IN ('amazon', 'boulanger', 'cdiscount', 'darty'))
);
--> statement-breakpoint
CREATE INDEX `inspection_requests_status_requested_idx` ON `inspection_requests` (`status`,`requested_at`);--> statement-breakpoint
CREATE INDEX `inspection_requests_owner_updated_idx` ON `inspection_requests` (`owner_id`,`updated_at`);--> statement-breakpoint
CREATE INDEX `inspection_requests_url_status_idx` ON `inspection_requests` (`url`,`status`);--> statement-breakpoint
CREATE TABLE `sentinel_frontier` (
	`id` text PRIMARY KEY NOT NULL,
	`url` text NOT NULL,
	`source` text NOT NULL,
	`market` text NOT NULL,
	`discovered_from` text,
	`discovery_type` text DEFAULT 'link' NOT NULL,
	`depth` integer DEFAULT 0 NOT NULL,
	`status` text DEFAULT 'queued' NOT NULL,
	`priority` integer DEFAULT 50 NOT NULL,
	`last_seen_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	`last_scanned_at` text,
	`next_scan_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	`hits` integer DEFAULT 0 NOT NULL,
	`duplicate_count` integer DEFAULT 0 NOT NULL,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	`updated_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	CONSTRAINT "sentinel_frontier_status_allowed" CHECK("sentinel_frontier"."status" IN ('queued', 'processing', 'active', 'blocked')),
	CONSTRAINT "sentinel_frontier_priority_range" CHECK("sentinel_frontier"."priority" BETWEEN 0 AND 100),
	CONSTRAINT "sentinel_frontier_depth_nonnegative" CHECK("sentinel_frontier"."depth" >= 0),
	CONSTRAINT "sentinel_frontier_hits_nonnegative" CHECK("sentinel_frontier"."hits" >= 0),
	CONSTRAINT "sentinel_frontier_duplicates_nonnegative" CHECK("sentinel_frontier"."duplicate_count" >= 0)
);
--> statement-breakpoint
CREATE UNIQUE INDEX `sentinel_frontier_url_unique` ON `sentinel_frontier` (`url`);--> statement-breakpoint
CREATE INDEX `sentinel_frontier_due_priority_idx` ON `sentinel_frontier` (`status`,`next_scan_at`,`priority`);--> statement-breakpoint
CREATE INDEX `sentinel_frontier_source_market_idx` ON `sentinel_frontier` (`source`,`market`);