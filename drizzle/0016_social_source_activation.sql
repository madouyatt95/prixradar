UPDATE `social_sources`
SET
	`enabled` = CASE
		WHEN `id` IN ('facebook:848306336465354', 'facebook:584379244259839') THEN 1
		ELSE 0
	END,
	`status` = CASE WHEN `platform` = 'x' THEN 'awaiting_access' ELSE 'ready' END,
	`last_attempt_at` = NULL,
	`last_success_at` = NULL,
	`last_error_code` = NULL,
	`updated_at` = CURRENT_TIMESTAMP
WHERE `id` IN (
	'facebook:848306336465354',
	'facebook:1262689252631531',
	'facebook:422132183776421',
	'facebook:584379244259839',
	'x:dealabs'
);
