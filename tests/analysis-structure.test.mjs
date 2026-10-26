import assert from "node:assert/strict";
import test from "node:test";
import { extractAnalysisSignals } from "../lib/analysis-structure.ts";

test("extracts only explicit plausible FX prices without inventing levels", () => {
  const signals = extractAnalysisSignals({
    body: "ドル円は157.60を上抜ければ上昇継続に注目。157.10割れでこの見方は失効。分析時刻は10時30分。",
    pair: "USD/JPY",
    stance: "BUY",
    sourceType: "SHIJIN",
  });
  assert.equal(signals.length, 2);
  assert.equal(signals[0].levelLow, 157.6);
  assert.equal(signals[0].trigger, "CROSS_ABOVE");
  assert.equal(signals[1].levelLow, 157.1);
  assert.equal(signals[1].trigger, "CROSS_BELOW");
  assert.ok(signals.every((signal) => signal.levelLow !== 10 && signal.levelLow !== 30));
});

test("keeps price ranges together and labels them as watch information", () => {
  const [signal] = extractAnalysisSignals({
    body: "ユーロドルは1.1620〜1.1640付近を戻り売り候補として監視する。",
    pair: "EUR/USD",
    stance: "SELL",
    sourceType: "YOUTUBE",
  });
  assert.equal(signal.levelLow, 1.162);
  assert.equal(signal.levelHigh, 1.164);
  assert.match(signal.message, /注目水準/);
  assert.doesNotMatch(signal.message, /エントリー成立/);
});

test("returns no signal when a manuscript has no explicit plausible price", () => {
  assert.deepEqual(extractAnalysisSignals({
    body: "ドル円は上昇傾向だが、具体的な価格条件はまだない。",
    pair: "USD/JPY",
    stance: "WAIT",
    sourceType: "OTHER",
  }), []);
});
