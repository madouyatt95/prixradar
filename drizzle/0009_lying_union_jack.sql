CREATE TABLE `mission_items` (
	`id` text PRIMARY KEY NOT NULL,
	`mission_id` text NOT NULL,
	`owner_id` text NOT NULL,
	`label` text NOT NULL,
	`query` text NOT NULL,
	`intent_json` text NOT NULL,
	`quantity` integer DEFAULT 1 NOT NULL,
	`required` integer DEFAULT true NOT NULL,
	`target_price_cents` integer,
	`selected_alert_id` text,
	`status` text DEFAULT 'searching' NOT NULL,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	`updated_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	FOREIGN KEY (`mission_id`) REFERENCES `radar_rules`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`selected_alert_id`) REFERENCES `alerts`(`id`) ON UPDATE no action ON DELETE set null,
	CONSTRAINT "mission_items_quantity_range" CHECK("mission_items"."quantity" BETWEEN 1 AND 99),
	CONSTRAINT "mission_items_target_positive" CHECK("mission_items"."target_price_cents" > 0),
	CONSTRAINT "mission_items_status_allowed" CHECK("mission_items"."status" IN ('searching', 'matched', 'purchased', 'skipped'))
);
--> statement-breakpoint
CREATE INDEX `mission_items_mission_status_idx` ON `mission_items` (`mission_id`,`status`);--> statement-breakpoint
CREATE INDEX `mission_items_owner_updated_idx` ON `mission_items` (`owner_id`,`updated_at`);--> statement-breakpoint
CREATE TABLE `purchase_events` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`purchase_id` text NOT NULL,
	`event_type` text NOT NULL,
	`price_cents` integer,
	`note` text,
	`occurred_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	FOREIGN KEY (`purchase_id`) REFERENCES `purchases`(`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "purchase_events_price_nonnegative" CHECK("purchase_events"."price_cents" >= 0),
	CONSTRAINT "purchase_events_type_allowed" CHECK("purchase_events"."event_type" IN ('purchased', 'price_checked', 'price_drop', 'action_opened', 'returned', 'kept', 'closed'))
);
--> statement-breakpoint
CREATE INDEX `purchase_events_purchase_time_idx` ON `purchase_events` (`purchase_id`,`occurred_at`);--> statement-breakpoint
CREATE TABLE `purchases` (
	`id` text PRIMARY KEY NOT NULL,
	`owner_id` text NOT NULL,
	`alert_id` text,
	`mission_id` text,
	`mission_item_id` text,
	`source` text NOT NULL,
	`market` text NOT NULL,
	`product_id` text NOT NULL,
	`title` text NOT NULL,
	`url` text NOT NULL,
	`currency` text NOT NULL,
	`paid_total_cents` integer NOT NULL,
	`reference_price_cents` integer NOT NULL,
	`realized_savings_cents` integer DEFAULT 0 NOT NULL,
	`latest_price_cents` integer,
	`best_price_cents` integer,
	`potential_recovery_cents` integer DEFAULT 0 NOT NULL,
	`status` text DEFAULT 'protected' NOT NULL,
	`action_reason` text,
	`purchased_at` text NOT NULL,
	`delivered_at` text,
	`protection_ends_at` text NOT NULL,
	`last_checked_at` text,
	`next_check_at` text NOT NULL,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	`updated_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	FOREIGN KEY (`alert_id`) REFERENCES `alerts`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`mission_id`) REFERENCES `radar_rules`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`mission_item_id`) REFERENCES `mission_items`(`id`) ON UPDATE no action ON DELETE set null,
	CONSTRAINT "purchases_paid_positive" CHECK("purchases"."paid_total_cents" > 0),
	CONSTRAINT "purchases_reference_positive" CHECK("purchases"."reference_price_cents" > 0),
	CONSTRAINT "purchases_savings_nonnegative" CHECK("purchases"."realized_savings_cents" >= 0),
	CONSTRAINT "purchases_latest_nonnegative" CHECK("purchases"."latest_price_cents" >= 0),
	CONSTRAINT "purchases_best_nonnegative" CHECK("purchases"."best_price_cents" >= 0),
	CONSTRAINT "purchases_recovery_nonnegative" CHECK("purchases"."potential_recovery_cents" >= 0),
	CONSTRAINT "purchases_currency_allowed" CHECK("purchases"."currency" IN ('EUR', 'GBP')),
	CONSTRAINT "purchases_status_allowed" CHECK("purchases"."status" IN ('protected', 'action_available', 'kept', 'returned', 'closed'))
);
--> statement-breakpoint
CREATE UNIQUE INDEX `purchases_owner_alert_unique` ON `purchases` (`owner_id`,`alert_id`);--> statement-breakpoint
CREATE INDEX `purchases_owner_purchased_idx` ON `purchases` (`owner_id`,`purchased_at`);--> statement-breakpoint
CREATE INDEX `purchases_protection_due_idx` ON `purchases` (`status`,`next_check_at`,`protection_ends_at`);--> statement-breakpoint
CREATE INDEX `purchases_product_lookup_idx` ON `purchases` (`source`,`market`,`product_id`);--> statement-breakpoint
ALTER TABLE `radar_rules` ADD `kind` text DEFAULT 'single' NOT NULL CHECK (`kind` IN ('single', 'project'));--> statement-breakpoint
ALTER TABLE `radar_rules` ADD `status` text DEFAULT 'active' NOT NULL CHECK (`status` IN ('active', 'paused', 'completed'));--> statement-breakpoint
ALTER TABLE `radar_rules` ADD `budget_cents` integer CHECK (`budget_cents` > 0);--> statement-breakpoint
ALTER TABLE `radar_rules` ADD `deadline_at` text;--> statement-breakpoint
ALTER TABLE `radar_rules` ADD `allow_alternatives` integer DEFAULT true NOT NULL;--> statement-breakpoint
ALTER TABLE `radar_rules` ADD `completed_at` text;--> statement-breakpoint
CREATE INDEX `radar_rules_owner_status_idx` ON `radar_rules` (`owner_id`,`status`);--> statement-breakpoint
