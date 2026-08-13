ALTER TABLE `social_notification_deliveries` ADD `attempt_id` text DEFAULT '' NOT NULL;
--> statement-breakpoint
ALTER TABLE `social_notification_deliveries` ADD `lease_expires_at` text;
--> statement-breakpoint
CREATE INDEX `social_notification_deliveries_status_lease_idx` ON `social_notification_deliveries` (`status`,`lease_expires_at`);
