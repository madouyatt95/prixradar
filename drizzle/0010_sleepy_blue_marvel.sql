CREATE TABLE `protection_notifications` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`purchase_id` text NOT NULL,
	`subscription_id` integer NOT NULL,
	`owner_id` text NOT NULL,
	`price_cents` integer NOT NULL,
	`status` text DEFAULT 'reserved' NOT NULL,
	`dedupe_key` text NOT NULL,
	`attempted_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	`sent_at` text,
	`error_code` text,
	FOREIGN KEY (`purchase_id`) REFERENCES `purchases`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`subscription_id`) REFERENCES `push_subscriptions`(`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "protection_notifications_price_positive" CHECK("protection_notifications"."price_cents" > 0),
	CONSTRAINT "protection_notifications_status_allowed" CHECK("protection_notifications"."status" IN ('reserved', 'sent', 'failed'))
);
--> statement-breakpoint
CREATE UNIQUE INDEX `protection_notifications_dedupe_unique` ON `protection_notifications` (`dedupe_key`);--> statement-breakpoint
CREATE INDEX `protection_notifications_purchase_idx` ON `protection_notifications` (`purchase_id`,`attempted_at`);--> statement-breakpoint
CREATE INDEX `protection_notifications_owner_idx` ON `protection_notifications` (`owner_id`,`attempted_at`);