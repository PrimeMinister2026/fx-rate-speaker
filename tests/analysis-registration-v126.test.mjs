import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";
import { extractAnalysisSignals } from "../lib/analysis-structure.ts";

test("one manuscript extracts multiple pairs, roles and opposing views without forcing one signal", () => {
  const signals = extractAnalysisSignals({ sourceType: "SHIJIN", body: [
    "ドル円は157.40が上値抵抗。反落確認後は戻り売り候補。157.80超えで売りシナリオ失効。",
    "ユーロ豪ドルは1.5940〜1.5960が戻り売り候補。第一利確は1.5910。",
    "別の見方ではドル円157.20から押し目買い候補。",
  ].join("\n") });
  assert.ok(new Set(signals.map((signal) => signal.pair)).size >= 2);
  assert.ok(signals.some((signal) => signal.priceRole === "ENTRY"));
  assert.ok(signals.some((signal) => signal.priceRole === "INVALIDATION"));
  assert.ok(signals.some((signal) => signal.stance === "BUY"));
  assert.ok(signals.some((signal) => signal.stance === "SELL"));
});

test("registration appends documents, filters inactive or expired signals and persists reload cooldown", async () => {
  const route = await readFile(new URL("../app/api/news/route.ts", import.meta.url), "utf8");
  const page = await readFile(new URL("../app/page.tsx", import.meta.url), "utf8");
  assert.match(route, /INSERT INTO market_analyses/);
  assert.doesNotMatch(route, /REPLACE INTO market_analyses/);
  assert.match(route, /status = 'ACTIVE'.*expires_at > \?/s);
  assert.match(page, /NAVIGATION_ALERT_STORAGE_KEY/);
  assert.match(page, /localStorage\.setItem\(NAVIGATION_ALERT_STORAGE_KEY/);
  assert.match(page, /pendingCommentaryRef\.current/);
  assert.match(page, /エントリー成立ではありません/);
});
