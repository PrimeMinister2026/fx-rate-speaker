import assert from "node:assert/strict";
import test from "node:test";
import {
  SYNTHETIC_CONFIG,
  applyCurrentCorrection,
  emptySyntheticLearningState,
  learnFromYahoo,
  rawSyntheticFor,
} from "../lib/synthetic.ts";

const seconds = (value) => value;

test("raw synthetic formulas are correct and sources must align within 20 seconds", () => {
  const now = 1_800_000_000_000;
  const at = Math.floor(now / 1000);
  const sources = {
    "USD/JPY": { price: 160, timestamp: seconds(at) },
    "EUR/JPY": { price: 176, timestamp: seconds(at - 10) },
    "GBP/JPY": { price: 208, timestamp: seconds(at - 5) },
  };
  assert.equal(rawSyntheticFor("EUR/USD", sources, now)?.rawSynthetic, 1.1);
  assert.equal(rawSyntheticFor("GBP/USD", sources, now)?.rawSynthetic, 1.3);
  assert.equal(rawSyntheticFor("EUR/GBP", sources, now)?.rawSynthetic, 176 / 208);
  assert.equal(rawSyntheticFor("EUR/USD", { ...sources, "EUR/JPY": { price: 176, timestamp: at - 21 } }, now), null);
});

function addSamples(count, error = 0.0002) {
  let state = emptySyntheticLearningState();
  for (let index = 1; index <= count; index += 1) {
    const point = {
      symbol: "EUR/USD",
      timestamp: index,
      rawSynthetic: 1.1,
      correctedSynthetic: 1.1,
      appliedCorrection: 0,
      sourceTimestamps: [index, index],
    };
    state = learnFromYahoo(state, { price: 1.1 + error, timestamp: index }, [point]).state;
  }
  return state;
}

test("learning observes warmup, rolling 100 samples, median robustness and persistence", () => {
  const raw = addSamples(19);
  assert.equal(raw.status, "RAW");
  assert.equal(raw.useCorrected, false);
  const corrected = addSamples(50);
  assert.equal(corrected.status, "CORRECTED");
  assert.equal(corrected.useCorrected, true);
  assert.ok(Math.abs(corrected.activeMedianError - 0.0002) < 1e-12);
  const rolling = addSamples(101);
  assert.equal(rolling.errors.length, SYNTHETIC_CONFIG.maxSamples);
  const restored = JSON.parse(JSON.stringify(rolling));
  assert.equal(restored.errors.length, 100);
  assert.equal(restored.status, "CORRECTED");

  const outlierPoint = { symbol: "EUR/USD", timestamp: 102, rawSynthetic: 1.1, correctedSynthetic: 1.1, appliedCorrection: 0, sourceTimestamps: [102, 102] };
  const withOutlier = learnFromYahoo(rolling, { price: 1.11, timestamp: 102 }, [outlierPoint]).state;
  assert.ok(Math.abs(withOutlier.activeMedianError - 0.0002) < 1e-12);
});

test("stale comparison is rejected and learned correction only affects future synthetic points", () => {
  const state = addSamples(50);
  const sameTimestamp = { symbol: "EUR/USD", timestamp: 50, rawSynthetic: 1.2, correctedSynthetic: 1.2, appliedCorrection: 0, sourceTimestamps: [50, 50] };
  assert.equal(applyCurrentCorrection(sameTimestamp, state).correctedSynthetic, 1.2);
  const point = { symbol: "EUR/USD", timestamp: 100, rawSynthetic: 1.2, correctedSynthetic: 1.2, appliedCorrection: 0, sourceTimestamps: [100, 100] };
  const beforeLearning = applyCurrentCorrection(point, state);
  assert.ok(Math.abs(beforeLearning.correctedSynthetic - 1.2002) < 1e-12);
  const rejected = learnFromYahoo(state, { price: 1.2002, timestamp: 121 }, [point]);
  assert.equal(rejected.accepted, false);
  assert.equal(beforeLearning.correctedSynthetic, 1.2002);
});

test("corrected quality improves for a stable bias and can disable when it is worse", () => {
  const improved = addSamples(100);
  assert.ok(improved.stats.correctedMaePips < improved.stats.rawMaePips);
  assert.ok(improved.stats.correctedP95Pips <= improved.stats.rawP95Pips);

  const badErrors = Array.from({ length: 49 }, (_, index) => ({
    timestamp: index + 1,
    error: 0.0001,
    rawErrorPips: 1,
    correctedErrorPips: 3,
  }));
  const badState = {
    ...emptySyntheticLearningState(),
    errors: badErrors,
    activeMedianError: 0.0004,
    lastYahooTimestamp: 49,
    status: "LEARNING",
  };
  const point = { symbol: "EUR/USD", timestamp: 50, rawSynthetic: 1.1, correctedSynthetic: 1.1, appliedCorrection: 0, sourceTimestamps: [50, 50] };
  const degraded = learnFromYahoo(badState, { price: 1.1001, timestamp: 50 }, [point]).state;
  assert.equal(degraded.useCorrected, false);
  assert.equal(degraded.status, "LEARNING");
});
