ALTER TABLE `analysis_signals` ADD `environment` text DEFAULT 'UNKNOWN' NOT NULL;--> statement-breakpoint
ALTER TABLE `analysis_signals` ADD `price_role` text DEFAULT 'WATCH' NOT NULL;--> statement-breakpoint
ALTER TABLE `analysis_signals` ADD `status` text DEFAULT 'ACTIVE' NOT NULL;--> statement-breakpoint
ALTER TABLE `market_analyses` ADD `source_type` text DEFAULT 'SHISHIN' NOT NULL;--> statement-breakpoint
ALTER TABLE `market_analyses` ADD `source_label` text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE `market_analyses` ADD `status` text DEFAULT 'ACTIVE' NOT NULL;--> statement-breakpoint
ALTER TABLE `market_analyses` ADD `retention_days` integer DEFAULT 90 NOT NULL;