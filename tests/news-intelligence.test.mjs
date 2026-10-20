import assert from "node:assert/strict";
import test from "node:test";
import {
  calendarResultSpeech,
  economicSurprise,
  findRapidCause,
} from "../lib/news-intelligence.ts";

const detectedAt = Date.parse("2026-10-20T15:00:00Z");

test("future and unrelated news never become a RAPID cause", () => {
  const result = findRapidCause("USD/JPY", detectedAt, [
    { id: "future", title: "日銀発表", summary: "", source: "日銀", publishedAt: detectedAt + 1, currencies: ["JPY"], level: "NEWS_L3" },
    { id: "eur", title: "ECB発表", summary: "", source: "ECB", publishedAt: detectedAt - 60_000, currencies: ["EUR"], level: "NEWS_L3" },
  ], []);
  assert.equal(result.confidence, "UNKNOWN");
});

test("related high-importance prior news is LIKELY, not asserted as fact", () => {
  const result = findRapidCause("USD/JPY", detectedAt, [
    { id: "boj", title: "金融政策発表", summary: "", source: "日銀", publishedAt: detectedAt - 2 * 60_000, currencies: ["JPY"], level: "NEWS_L3" },
  ], []);
  assert.equal(result.confidence, "LIKELY");
  assert.match(result.text, /可能性/);
});

test("CONFIRMED requires an explicit causal marker", () => {
  const result = findRapidCause("EUR/USD", detectedAt, [
    { id: "wire", title: "Fed remarks lift dollar", summary: "", source: "trusted wire", publishedAt: detectedAt - 30_000, currencies: ["USD"], level: "NEWS_L3", explicitMarketCause: true },
  ], []);
  assert.equal(result.confidence, "CONFIRMED");
});

test("economic surprise is ranked and spoken as fact only", () => {
  const event = { id: "cpi", title: "アメリカCPI", currency: "USD", scheduledAt: detectedAt - 60_000, level: "L3", actual: "3.2%", forecast: "3.0%", previous: "3.1%" };
  assert.equal(economicSurprise(event)?.meaningful, true);
  assert.match(calendarResultSpeech(event), /結果3\.2%/);
  assert.match(calendarResultSpeech(event), /予想を上回りました/);
  const cause = findRapidCause("USD/JPY", detectedAt, [], [event]);
  assert.equal(cause.confidence, "LIKELY");
});
