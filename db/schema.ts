import { integer, sqliteTable, text, uniqueIndex } from "drizzle-orm/sqlite-core";

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
