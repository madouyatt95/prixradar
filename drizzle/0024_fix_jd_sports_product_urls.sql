UPDATE `alerts`
SET `url` = 'https://www.jdsports.fr/' || ltrim(substr(`url`, instr(`url`, '/product/')), '/')
WHERE `source` = 'jd_sports' AND `url` LIKE 'https://%jdsports.fr/product/%';
--> statement-breakpoint
UPDATE `alerts`
SET `url` = `url` || '/'
WHERE `source` = 'jd_sports' AND `url` LIKE 'https://www.jdsports.fr/product/%' AND substr(`url`, -1) <> '/';
--> statement-breakpoint
UPDATE `merchant_products`
SET `url` = 'https://www.jdsports.fr/' || ltrim(substr(`url`, instr(`url`, '/product/')), '/')
WHERE `source` = 'jd_sports' AND `url` LIKE 'https://%jdsports.fr/product/%';
--> statement-breakpoint
UPDATE `merchant_products`
SET `url` = `url` || '/'
WHERE `source` = 'jd_sports' AND `url` LIKE 'https://www.jdsports.fr/product/%' AND substr(`url`, -1) <> '/';
--> statement-breakpoint
UPDATE `watchlist_items`
SET `url` = 'https://www.jdsports.fr/' || ltrim(substr(`url`, instr(`url`, '/product/')), '/')
WHERE `source` = 'jd_sports' AND `url` LIKE 'https://%jdsports.fr/product/%';
--> statement-breakpoint
UPDATE `watchlist_items`
SET `url` = `url` || '/'
WHERE `source` = 'jd_sports' AND `url` LIKE 'https://www.jdsports.fr/product/%' AND substr(`url`, -1) <> '/';
--> statement-breakpoint
UPDATE `inspection_requests`
SET `url` = 'https://www.jdsports.fr/' || ltrim(substr(`url`, instr(`url`, '/product/')), '/')
WHERE `source` = 'jd_sports' AND `url` LIKE 'https://%jdsports.fr/product/%';
--> statement-breakpoint
UPDATE `inspection_requests`
SET `url` = `url` || '/'
WHERE `source` = 'jd_sports' AND `url` LIKE 'https://www.jdsports.fr/product/%' AND substr(`url`, -1) <> '/';
--> statement-breakpoint
UPDATE `purchases`
SET `url` = 'https://www.jdsports.fr/' || ltrim(substr(`url`, instr(`url`, '/product/')), '/')
WHERE `source` = 'jd_sports' AND `url` LIKE 'https://%jdsports.fr/product/%';
--> statement-breakpoint
UPDATE `purchases`
SET `url` = `url` || '/'
WHERE `source` = 'jd_sports' AND `url` LIKE 'https://www.jdsports.fr/product/%' AND substr(`url`, -1) <> '/';
--> statement-breakpoint
UPDATE `recheck_requests`
SET `url` = 'https://www.jdsports.fr/' || ltrim(substr(`url`, instr(`url`, '/product/')), '/')
WHERE `source` = 'jd_sports' AND `url` LIKE 'https://%jdsports.fr/product/%';
--> statement-breakpoint
UPDATE `recheck_requests`
SET `url` = `url` || '/'
WHERE `source` = 'jd_sports' AND `url` LIKE 'https://www.jdsports.fr/product/%' AND substr(`url`, -1) <> '/';
