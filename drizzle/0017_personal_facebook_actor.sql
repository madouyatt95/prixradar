UPDATE `social_sources`
SET
	`collection_mode` = 'public_browser',
	`cadence_minutes` = 15,
	`updated_at` = CURRENT_TIMESTAMP
WHERE `platform` = 'facebook';
