CREATE TABLE `social_collection_runs` (
	`id` text PRIMARY KEY NOT NULL,
	`provider` text DEFAULT 'apify_facebook_groups' NOT NULL,
	`status` text DEFAULT 'reserved' NOT NULL,
	`source_count` integer NOT NULL,
	`posts_returned` integer DEFAULT 0 NOT NULL,
	`estimated_cost_micros` integer NOT NULL,
	`cursor_from` text NOT NULL,
	`provider_run_id` text,
	`started_at` text NOT NULL,
	`finished_at` text,
	`error_code` text,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	`updated_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	CONSTRAINT "social_collection_runs_provider_allowed" CHECK("social_collection_runs"."provider" IN ('apify_facebook_groups')),
	CONSTRAINT "social_collection_runs_status_allowed" CHECK("social_collection_runs"."status" IN ('reserved', 'succeeded', 'failed')),
	CONSTRAINT "social_collection_runs_sources_positive" CHECK("social_collection_runs"."source_count" BETWEEN 1 AND 20),
	CONSTRAINT "social_collection_runs_posts_nonnegative" CHECK("social_collection_runs"."posts_returned" >= 0),
	CONSTRAINT "social_collection_runs_cost_nonnegative" CHECK("social_collection_runs"."estimated_cost_micros" >= 0)
);
--> statement-breakpoint
CREATE INDEX `social_collection_runs_started_idx` ON `social_collection_runs` (`started_at`);--> statement-breakpoint
CREATE INDEX `social_collection_runs_status_started_idx` ON `social_collection_runs` (`status`,`started_at`);
