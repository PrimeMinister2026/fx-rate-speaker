import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const page = await readFile(new URL("../app/page.tsx", import.meta.url), "utf8");
const route = await readFile(new URL("../app/api/analysis-admin/route.ts", import.meta.url), "utf8");

test("v127 exposes an authenticated analysis library with all lifecycle states", () => {
  assert.match(route, /requireAdmin/);
  assert.match(route, /ACTIVE.*HOLD.*INVALID.*EXPIRED.*ARCHIVED/);
  assert.match(page, /相場分析 管理/);
  assert.match(page, /期限切れ・失効・保留は実況されません/);
  assert.match(page, /アーカイブは削除ではなく保管/);
});

test("v127 keeps manuscripts and extracted signals separately manageable", () => {
  assert.match(route, /FROM market_analyses ORDER BY created_at DESC/);
  assert.match(route, /FROM analysis_signals ORDER BY created_at ASC/);
  assert.match(route, /UPDATE analysis_signals SET status/);
  assert.match(page, /旧原稿を再解析/);
  assert.match(page, /抽出済み価格情報がありません。原稿は残っています/);
});

test("legacy re-extraction is review-first and never auto-spoken", () => {
  assert.match(route, /VALUES \(\?, \?, \?, \?, \?, \?, \?, \?, \?, \?, \?, \?, \?, \?, \?, \?, \?, \?, 'HOLD', \?\)/);
  assert.match(route, /安全のため保留で保存しました/);
  assert.match(route, /COUNT\(\*\) AS count FROM analysis_signals/);
});
