CREATE TABLE `market_analyses` (
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
	`dedupe_key` text NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `market_analyses_dedupe_key_unique` ON `market_analyses` (`dedupe_key`);