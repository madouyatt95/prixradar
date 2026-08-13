CREATE TABLE IF NOT EXISTS `social_dispatch_leases` (
	`id` text PRIMARY KEY NOT NULL,
	`attempt_id` text NOT NULL,
	`lease_expires_at` text NOT NULL,
	`updated_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `social_dispatch_leases_expiry_idx` ON `social_dispatch_leases` (`lease_expires_at`);
