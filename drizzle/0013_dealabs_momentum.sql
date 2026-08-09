CREATE TABLE `community_signals` (
	`id` text PRIMARY KEY NOT NULL,
	`provider` text DEFAULT 'dealabs' NOT NULL,
	`external_id` text NOT NULL,
	`title` text NOT NULL,
	`merchant` text NOT NULL,
	`category` text,
	`deal_url` text NOT NULL,
	`merchant_url` text,
	`image_url` text,
	`source` text,
	`market` text,
	`product_id` text,
	`currency` text DEFAULT 'EUR' NOT NULL,
	`price_cents` integer,
	`temperature` integer DEFAULT 0 NOT NULL,
	`velocity_x100` integer DEFAULT 0 NOT NULL,
	`status` text DEFAULT 'new' NOT NULL,
	`inspection_request_id` text,
	`published_at` text NOT NULL,
	`first_seen_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	`last_seen_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	`updated_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	CONSTRAINT `community_signals_provider_allowed` CHECK(`community_signals`.`provider` = 'dealabs'),
	CONSTRAINT `community_signals_currency_allowed` CHECK(`community_signals`.`currency` IN ('EUR', 'GBP')),
	CONSTRAINT `community_signals_price_nonnegative` CHECK(`community_signals`.`price_cents` >= 0),
	CONSTRAINT `community_signals_temperature_nonnegative` CHECK(`community_signals`.`temperature` >= 0),
	CONSTRAINT `community_signals_velocity_nonnegative` CHECK(`community_signals`.`velocity_x100` >= 0),
	CONSTRAINT `community_signals_status_allowed` CHECK(`community_signals`.`status` IN ('new', 'heating', 'hot', 'cooling', 'stale'))
);
--> statement-breakpoint
CREATE UNIQUE INDEX `community_signals_provider_external_unique` ON `community_signals` (`provider`,`external_id`);
--> statement-breakpoint
CREATE INDEX `community_signals_status_seen_idx` ON `community_signals` (`status`,`last_seen_at`);
--> statement-breakpoint
CREATE INDEX `community_signals_temperature_seen_idx` ON `community_signals` (`temperature`,`last_seen_at`);
--> statement-breakpoint
CREATE INDEX `community_signals_product_idx` ON `community_signals` (`source`,`market`,`product_id`);
--> statement-breakpoint
CREATE TABLE `community_signal_observations` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`signal_id` text NOT NULL,
	`temperature` integer NOT NULL,
	`observed_at` text NOT NULL,
	FOREIGN KEY (`signal_id`) REFERENCES `community_signals`(`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT `community_signal_observations_temperature_nonnegative` CHECK(`community_signal_observations`.`temperature` >= 0)
);
--> statement-breakpoint
CREATE UNIQUE INDEX `community_signal_observation_unique` ON `community_signal_observations` (`signal_id`,`temperature`,`observed_at`);
--> statement-breakpoint
CREATE INDEX `community_signal_observation_signal_seen_idx` ON `community_signal_observations` (`signal_id`,`observed_at`);
