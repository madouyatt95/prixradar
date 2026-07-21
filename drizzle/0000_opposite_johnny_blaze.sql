CREATE TABLE `watchlist_items` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`owner_id` text NOT NULL,
	`product_id` text NOT NULL,
	`source` text NOT NULL,
	`title` text NOT NULL,
	`market` text NOT NULL,
	`price_cents` integer NOT NULL,
	`url` text NOT NULL,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	`updated_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `watchlist_owner_product_source_market_unique` ON `watchlist_items` (`owner_id`,`product_id`,`source`,`market`);--> statement-breakpoint
CREATE INDEX `watchlist_owner_updated_idx` ON `watchlist_items` (`owner_id`,`updated_at`);