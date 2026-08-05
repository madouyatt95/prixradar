CREATE TABLE `ean_scan_requests` (
	`id` text PRIMARY KEY NOT NULL,
	`owner_id` text NOT NULL,
	`gtin` text NOT NULL,
	`status` text DEFAULT 'queued' NOT NULL,
	`radar_rule_id` text,
	`canonical_product_id` text,
	`matched_alert_id` text,
	`result_json` text DEFAULT '{}' NOT NULL,
	`requested_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	`claimed_at` text,
	`last_checked_at` text,
	`next_check_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	`updated_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	FOREIGN KEY (`canonical_product_id`) REFERENCES `canonical_products`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`matched_alert_id`) REFERENCES `alerts`(`id`) ON UPDATE no action ON DELETE set null,
	CONSTRAINT "ean_scan_status_allowed" CHECK("ean_scan_requests"."status" IN ('queued', 'processing', 'monitoring', 'matched', 'failed'))
);
--> statement-breakpoint
CREATE UNIQUE INDEX `ean_scan_owner_gtin_unique` ON `ean_scan_requests` (`owner_id`,`gtin`);--> statement-breakpoint
CREATE INDEX `ean_scan_status_due_idx` ON `ean_scan_requests` (`status`,`next_check_at`);--> statement-breakpoint
CREATE INDEX `ean_scan_owner_updated_idx` ON `ean_scan_requests` (`owner_id`,`updated_at`);--> statement-breakpoint
CREATE INDEX `ean_scan_gtin_idx` ON `ean_scan_requests` (`gtin`);