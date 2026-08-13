INSERT OR IGNORE INTO `discovery_segments` (
  `id`, `source`, `market`, `label`, `category_ids_json`,
  `min_price_cents`, `max_price_cents`, `minimum_drop_percent`,
  `daily_token_budget`, `cadence_minutes`, `priority`, `enabled`
) VALUES
  ('amazon-fr-tech', 'amazon', 'FR', 'High-Tech et informatique', '{"include":[14011561,340859031],"excludeFamilies":["books","music","media","wall_art"]}', 2000, 250000, 35, 384, 30, 100, 1),
  ('amazon-fr-maison', 'amazon', 'FR', 'Maison et électroménager', '{"include":[908827031,57686031],"excludeFamilies":["books","music","media","wall_art"]}', 2000, 300000, 35, 288, 30, 90, 1),
  ('amazon-fr-bricolage', 'amazon', 'FR', 'Bricolage et jardin', '{"include":[590749031,3557028031],"excludeFamilies":["books","music","media","wall_art"]}', 1500, 200000, 35, 192, 30, 80, 1),
  ('amazon-fr-sport-beaute', 'amazon', 'FR', 'Sport et beauté', '{"include":[325615031,197859031],"excludeFamilies":["books","music","media","wall_art"]}', 1500, 100000, 35, 96, 30, 70, 1);
--> statement-breakpoint
UPDATE `source_configurations`
SET
  `display_name` = 'JD Sports · Chaussures en promotion',
  `discovery_url` = 'https://www.jdsports.fr/promo/c/chaussures/',
  `category` = 'Chaussures',
  `page_cursor` = NULL,
  `enabled` = 1,
  `cadence_minutes` = 30,
  `volatility_score` = 60,
  `last_run_at` = NULL,
  `last_success_at` = NULL,
  `products_seen` = 0,
  `failure_streak` = 0,
  `anti_bot_streak` = 0,
  `circuit_state` = 'closed',
  `cooldown_until` = NULL,
  `last_error_code` = NULL,
  `daily_product_budget` = 72,
  `updated_at` = CURRENT_TIMESTAMP
WHERE `id` = 'jd-sports-fr-chaussures';
--> statement-breakpoint
UPDATE `source_configurations`
SET
  `display_name` = 'JD Sports · Homme · Vêtements en promotion',
  `discovery_url` = 'https://www.jdsports.fr/homme/vetements-homme/promo/',
  `category` = 'Vêtements homme',
  `page_cursor` = NULL,
  `enabled` = 1,
  `cadence_minutes` = 30,
  `volatility_score` = 60,
  `last_run_at` = NULL,
  `last_success_at` = NULL,
  `products_seen` = 0,
  `failure_streak` = 0,
  `anti_bot_streak` = 0,
  `circuit_state` = 'closed',
  `cooldown_until` = NULL,
  `last_error_code` = NULL,
  `daily_product_budget` = 72,
  `updated_at` = CURRENT_TIMESTAMP
WHERE `id` = 'jd-sports-fr-vetements';
--> statement-breakpoint
UPDATE `source_configurations`
SET
  `display_name` = 'JD Sports · Femme · Vêtements en promotion',
  `discovery_url` = 'https://www.jdsports.fr/femme/vetements-femme/promo/',
  `category` = 'Vêtements femme',
  `page_cursor` = NULL,
  `enabled` = 1,
  `cadence_minutes` = 30,
  `volatility_score` = 60,
  `last_run_at` = NULL,
  `last_success_at` = NULL,
  `products_seen` = 0,
  `failure_streak` = 0,
  `anti_bot_streak` = 0,
  `circuit_state` = 'closed',
  `cooldown_until` = NULL,
  `last_error_code` = NULL,
  `daily_product_budget` = 72,
  `updated_at` = CURRENT_TIMESTAMP
WHERE `id` = 'jd-sports-fr-accessoires';
