CREATE TABLE `social_sources` (
	`id` text PRIMARY KEY NOT NULL,
	`platform` text NOT NULL,
	`name` text NOT NULL,
	`external_id` text NOT NULL,
	`url` text NOT NULL,
	`collection_mode` text NOT NULL,
	`enabled` integer DEFAULT true NOT NULL,
	`status` text DEFAULT 'ready' NOT NULL,
	`cadence_minutes` integer DEFAULT 5 NOT NULL,
	`last_attempt_at` text,
	`last_success_at` text,
	`last_error_code` text,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	`updated_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	CONSTRAINT "social_sources_platform_allowed" CHECK("social_sources"."platform" IN ('facebook', 'x')),
	CONSTRAINT "social_sources_mode_allowed" CHECK("social_sources"."collection_mode" IN ('public_browser', 'x_api')),
	CONSTRAINT "social_sources_status_allowed" CHECK("social_sources"."status" IN ('ready', 'live', 'degraded', 'blocked', 'awaiting_access')),
	CONSTRAINT "social_sources_cadence_range" CHECK("social_sources"."cadence_minutes" BETWEEN 1 AND 1440)
);
--> statement-breakpoint
CREATE UNIQUE INDEX `social_sources_platform_external_unique` ON `social_sources` (`platform`,`external_id`);--> statement-breakpoint
CREATE INDEX `social_sources_enabled_status_idx` ON `social_sources` (`enabled`,`status`);--> statement-breakpoint
INSERT INTO `social_sources` (`id`, `platform`, `name`, `external_id`, `url`, `collection_mode`, `enabled`, `status`, `cadence_minutes`) VALUES
('facebook:848306336465354', 'facebook', 'SARAH · Les Addicts Des Bons Plans', '848306336465354', 'https://www.facebook.com/groups/848306336465354/', 'public_browser', 1, 'ready', 5),
('facebook:1262689252631531', 'facebook', 'SARAH · Bons Plans Sarah good deals', '1262689252631531', 'https://www.facebook.com/groups/1262689252631531/', 'public_browser', 1, 'ready', 5),
('facebook:422132183776421', 'facebook', 'Bons plans et erreurs de prix · Lacerise', '422132183776421', 'https://www.facebook.com/groups/422132183776421/', 'public_browser', 1, 'ready', 5),
('facebook:584379244259839', 'facebook', 'Bons plans courses et réductions · Mélina', '584379244259839', 'https://www.facebook.com/groups/584379244259839/', 'public_browser', 1, 'ready', 5),
('x:dealabs', 'x', 'Dealabs', 'dealabs', 'https://x.com/dealabs', 'x_api', 0, 'awaiting_access', 1);--> statement-breakpoint
CREATE TABLE `social_publications` (
	`id` text PRIMARY KEY NOT NULL,
	`source_id` text NOT NULL,
	`external_id` text NOT NULL,
	`author` text NOT NULL,
	`text` text NOT NULL,
	`publication_url` text NOT NULL,
	`image_url` text,
	`external_url` text,
	`published_at` text NOT NULL,
	`first_seen_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	`last_seen_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	`updated_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	FOREIGN KEY (`source_id`) REFERENCES `social_sources`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `social_publications_source_external_unique` ON `social_publications` (`source_id`,`external_id`);--> statement-breakpoint
CREATE INDEX `social_publications_published_idx` ON `social_publications` (`published_at`);--> statement-breakpoint
CREATE INDEX `social_publications_source_published_idx` ON `social_publications` (`source_id`,`published_at`);--> statement-breakpoint
CREATE TABLE `social_notification_deliveries` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`publication_id` text NOT NULL,
	`subscription_id` integer NOT NULL,
	`owner_id` text NOT NULL,
	`status` text DEFAULT 'reserved' NOT NULL,
	`dedupe_key` text NOT NULL,
	`attempted_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	`sent_at` text,
	`error_code` text,
	FOREIGN KEY (`publication_id`) REFERENCES `social_publications`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`subscription_id`) REFERENCES `push_subscriptions`(`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "social_notification_deliveries_status_allowed" CHECK("social_notification_deliveries"."status" IN ('reserved', 'sent', 'failed', 'suppressed'))
);
--> statement-breakpoint
CREATE UNIQUE INDEX `social_notification_deliveries_dedupe_unique` ON `social_notification_deliveries` (`dedupe_key`);--> statement-breakpoint
CREATE INDEX `social_notification_deliveries_publication_idx` ON `social_notification_deliveries` (`publication_id`,`attempted_at`);--> statement-breakpoint
CREATE INDEX `social_notification_deliveries_owner_idx` ON `social_notification_deliveries` (`owner_id`,`attempted_at`);--> statement-breakpoint
ALTER TABLE `user_preferences` ADD `social_notifications_enabled` integer DEFAULT false NOT NULL;
