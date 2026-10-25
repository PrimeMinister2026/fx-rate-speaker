import { integer, real, sqliteTable, text, uniqueIndex } from "drizzle-orm/sqlite-core";

export const marketAnalyses = sqliteTable("market_analyses", {
  id: text("id").primaryKey(),
  createdAt: integer("created_at").notNull(),
  createdBy: text("created_by").notNull(),
  publishAt: integer("publish_at").notNull(),
  analysisAt: integer("analysis_at").notNull(),
  expiresAt: integer("expires_at").notNull(),
  pair: text("pair").notNull(),
  stance: text("stance", { enum: ["BUY", "SELL", "WAIT"] }).notNull(),
  headline: text("headline").notNull(),
  body: text("body").notNull(),
  dedupeKey: text("dedupe_key").notNull(),
}, (table) => [uniqueIndex("market_analyses_dedupe_key_unique").on(table.dedupeKey)]);

export const analysisSignals = sqliteTable("analysis_signals", {
  id: text("id").primaryKey(),
  analysisId: text("analysis_id").notNull(),
  createdAt: integer("created_at").notNull(),
  publishAt: integer("publish_at").notNull(),
  analysisAt: integer("analysis_at").notNull(),
  expiresAt: integer("expires_at").notNull(),
  sourceType: text("source_type", { enum: ["SHISHIN", "YOUTUBE", "OTHER"] }).notNull(),
  pair: text("pair").notNull(),
  stance: text("stance", { enum: ["BUY", "SELL", "WAIT"] }).notNull(),
  levelLow: real("level_low").notNull(),
  levelHigh: real("level_high").notNull(),
  trigger: text("trigger", { enum: ["APPROACH", "CROSS_ABOVE", "CROSS_BELOW", "REBOUND", "REJECTION"] }).notNull(),
  conditionText: text("condition_text").notNull(),
  invalidationText: text("invalidation_text").notNull(),
  sourceExcerpt: text("source_excerpt").notNull(),
  message: text("message").notNull(),
  dedupeKey: text("dedupe_key").notNull(),
}, (table) => [uniqueIndex("analysis_signals_dedupe_key_unique").on(table.dedupeKey)]);
