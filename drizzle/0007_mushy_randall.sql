CREATE TABLE `source_coverage_products` (
	`source_configuration_id` text NOT NULL,
	`product_key` text NOT NULL,
	`product_url` text NOT NULL,
	`first_seen_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	`last_seen_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	FOREIGN KEY (`source_configuration_id`) REFERENCES `source_configurations`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `source_coverage_config_product_unique` ON `source_coverage_products` (`source_configuration_id`,`product_key`);--> statement-breakpoint
CREATE INDEX `source_coverage_product_key_idx` ON `source_coverage_products` (`product_key`);--> statement-breakpoint
CREATE INDEX `source_coverage_product_url_idx` ON `source_coverage_products` (`product_url`);--> statement-breakpoint
CREATE INDEX `source_coverage_config_last_seen_idx` ON `source_coverage_products` (`source_configuration_id`,`last_seen_at`);