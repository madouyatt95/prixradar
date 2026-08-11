UPDATE `social_sources`
SET
	`collection_mode` = 'public_browser',
	`enabled` = 0,
	`status` = 'blocked',
	`cadence_minutes` = 15,
	`last_error_code` = 'FACEBOOK_AUTOMATION_UNAVAILABLE',
	`updated_at` = CURRENT_TIMESTAMP
WHERE `platform` = 'facebook';
