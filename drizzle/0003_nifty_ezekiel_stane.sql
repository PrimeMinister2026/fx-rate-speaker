PRAGMA foreign_keys=OFF;--> statement-breakpoint
CREATE TABLE `__new_market_analyses` (
	`id` text PRIMARY KEY NOT NULL,
	`created_at` integer NOT NULL,
	`created_by` text NOT NULL,
	`publish_at` integer NOT NULL,
	`analysis_at` integer NOT NULL,
	`expires_at` integer NOT NULL,
	`pair` text NOT NULL,
	`stance` text NOT NULL,
	`headline` text NOT NULL,
	`body` text NOT NULL,
	`source_type` text DEFAULT 'SHIJIN' NOT NULL,
	`source_label` text DEFAULT '' NOT NULL,
	`status` text DEFAULT 'ACTIVE' NOT NULL,
	`retention_days` integer DEFAULT 90 NOT NULL,
	`dedupe_key` text NOT NULL
);
--> statement-breakpoint
INSERT INTO `__new_market_analyses`("id", "created_at", "created_by", "publish_at", "analysis_at", "expires_at", "pair", "stance", "headline", "body", "source_type", "source_label", "status", "retention_days", "dedupe_key") SELECT "id", "created_at", "created_by", "publish_at", "analysis_at", "expires_at", "pair", "stance", "headline", "body", "source_type", "source_label", "status", "retention_days", "dedupe_key" FROM `market_analyses`;--> statement-breakpoint
DROP TABLE `market_analyses`;--> statement-breakpoint
ALTER TABLE `__new_market_analyses` RENAME TO `market_analyses`;--> statement-breakpoint
UPDATE `market_analyses` SET `source_type` = 'SHIJIN' WHERE `source_type` = 'SHISHIN';--> statement-breakpoint
UPDATE `analysis_signals` SET `source_type` = 'SHIJIN' WHERE `source_type` = 'SHISHIN';--> statement-breakpoint
PRAGMA foreign_keys=ON;--> statement-breakpoint
CREATE UNIQUE INDEX `market_analyses_dedupe_key_unique` ON `market_analyses` (`dedupe_key`);
