import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const route = await readFile(new URL("../app/api/news/route.ts", import.meta.url), "utf8");
const page = await readFile(new URL("../app/page.tsx", import.meta.url), "utf8");

test("v128 standardizes 四神 as SHIJIN while accepting cached legacy clients", () => {
  assert.match(page, /value="SHIJIN">四神相場分析/);
  assert.doesNotMatch(page, /SHISHIN/);
  assert.match(route, /rawSourceType === "SHISHIN" \? "SHIJIN"/);
});

test("v128 accepts weekly outlooks without changing the 24-hour default", () => {
  assert.match(route, /MAX_ANALYSIS_AGE_MS = 7 \* 24/);
  assert.match(route, /MAX_ANALYSIS_LIFETIME_MS = 10 \* 24/);
  assert.match(page, /expiresAt: localDateTimeInput\(now \+ 24 \* 60 \* 60 \* 1000\)/);
});
