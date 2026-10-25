CREATE TABLE `analysis_signals` (
	`id` text PRIMARY KEY NOT NULL,
	`analysis_id` text NOT NULL,
	`created_at` integer NOT NULL,
	`publish_at` integer NOT NULL,
	`analysis_at` integer NOT NULL,
	`expires_at` integer NOT NULL,
	`source_type` text NOT NULL,
	`pair` text NOT NULL,
	`stance` text NOT NULL,
	`level_low` real NOT NULL,
	`level_high` real NOT NULL,
	`trigger` text NOT NULL,
	`condition_text` text NOT NULL,
	`invalidation_text` text NOT NULL,
	`source_excerpt` text NOT NULL,
	`message` text NOT NULL,
	`dedupe_key` text NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `analysis_signals_dedupe_key_unique` ON `analysis_signals` (`dedupe_key`);