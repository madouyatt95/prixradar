UPDATE `discovery_segments`
SET
  `enabled` = 1,
  `daily_token_budget` = 576,
  `cadence_minutes` = 30,
  `priority` = 100,
  `last_run_at` = NULL,
  `updated_at` = CURRENT_TIMESTAMP
WHERE `id` = 'amazon-fr-tech';
--> statement-breakpoint
UPDATE `discovery_segments`
SET
  `enabled` = 1,
  `daily_token_budget` = 384,
  `cadence_minutes` = 30,
  `priority` = 90,
  `last_run_at` = NULL,
  `updated_at` = CURRENT_TIMESTAMP
WHERE `id` = 'amazon-fr-maison';
--> statement-breakpoint
UPDATE `discovery_segments`
SET
  `enabled` = 0,
  `last_run_at` = NULL,
  `updated_at` = CURRENT_TIMESTAMP
WHERE `id` IN ('amazon-fr-bricolage', 'amazon-fr-sport-beaute');
