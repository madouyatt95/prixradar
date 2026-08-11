UPDATE `social_sources`
SET
	`enabled` = CASE
		WHEN `id` IN (
			'facebook:848306336465354',
			'facebook:584379244259839'
		) THEN 1
		ELSE 0
	END,
	`status` = 'ready',
	`cadence_minutes` = 5,
	`last_error_code` = NULL,
	`updated_at` = CURRENT_TIMESTAMP
WHERE `platform` = 'facebook';
