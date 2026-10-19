import assert from "node:assert/strict";
import test from "node:test";
import { STRENGTH_PAIR_CODES, calculateCurrencyStrength, pairPeriodSignal, periodPoints } from "../lib/currency-strength.ts";

const currencies = ["USD", "JPY", "EUR", "GBP", "AUD"];

function historiesFromCurrencySlopes(slopes, minutes = 65, spacingSeconds = 60) {
  const points = Math.floor(minutes * 60 / spacingSeconds) + 1;
  return Object.fromEntries(STRENGTH_PAIR_CODES.map((pairCode) => {
    const [base, quote] = pairCode.split("/");
    const pairSlope = slopes[base] - slopes[quote];
    return [pairCode, Array.from({ length: points }, (_, index) => ({
      price: Math.exp(5 + pairSlope * index * spacingSeconds / 60),
      timestamp: index * spacingSeconds,
    }))];
  }));
}

test("ten-pair time-window strength keeps base and quote directions coherent", () => {
  const histories = historiesFromCurrencySlopes({ USD: .00025, JPY: -.00025, EUR: 0, GBP: .00002, AUD: -.00002 });
  const result = calculateCurrencyStrength(histories, 60);
  assert.equal(result.ready, true);
  assert.equal(result.usedPairs, 10);
  assert.ok(result.scores.USD > result.scores.EUR);
  assert.ok(result.scores.JPY < result.scores.EUR);
  assert.ok(result.pairScores["USD/JPY"] > 0);
  assert.ok(result.pairScores["EUR/USD"] < 0);
  assert.ok(result.pairScores["AUD/JPY"] > 0);
  assert.deepEqual(Object.keys(result.pairScores).sort(), [...STRENGTH_PAIR_CODES].sort());
});

test("AUD strengthening changes all four AUD connections coherently", () => {
  const histories = historiesFromCurrencySlopes({ USD: 0, JPY: -.00003, EUR: .00001, GBP: .00002, AUD: .0003 });
  const result = calculateCurrencyStrength(histories, 15);
  assert.ok(result.scores.AUD > result.scores.USD);
  assert.ok(result.pairScores["AUD/USD"] > 0);
  assert.ok(result.pairScores["AUD/JPY"] > 0);
  assert.ok(result.pairScores["EUR/AUD"] < 0);
  assert.ok(result.pairScores["GBP/AUD"] < 0);
});

test("60m, 15m, 5m and 1m require their own elapsed-time coverage", () => {
  const histories = historiesFromCurrencySlopes({ USD: .00008, JPY: -.00008, EUR: .00003, GBP: 0, AUD: -.00003 }, 13);
  assert.equal(calculateCurrencyStrength(histories, 60).ready, false);
  assert.equal(calculateCurrencyStrength(histories, 15).ready, false);
  assert.equal(calculateCurrencyStrength(histories, 5).ready, true);
  assert.equal(calculateCurrencyStrength(histories, 1).ready, true);
});

test("time windows use timestamps rather than observation counts", () => {
  const regular = historiesFromCurrencySlopes({ USD: .00008, JPY: -.00008, EUR: 0, GBP: 0, AUD: 0 }, 65, 60);
  const irregular = historiesFromCurrencySlopes({ USD: .00008, JPY: -.00008, EUR: 0, GBP: 0, AUD: 0 }, 65, 20);
  const regularPeriod = periodPoints(regular["USD/JPY"], 15);
  const irregularPeriod = periodPoints(irregular["USD/JPY"], 15);
  assert.equal(regularPeriod.endTimestamp - regularPeriod.startTimestamp, 15 * 60);
  assert.equal(irregularPeriod.endTimestamp - irregularPeriod.startTimestamp, 15 * 60);
  assert.equal(regularPeriod.points.length, 16);
  assert.equal(irregularPeriod.points.length, 46);
  assert.ok(calculateCurrencyStrength(regular, 15).pairScores["USD/JPY"] > 0);
  assert.ok(calculateCurrencyStrength(irregular, 15).pairScores["USD/JPY"] > 0);
});

test("60m, 15m, 5m and 1m can show different stages of a reversal", () => {
  const currencyPaths = Object.fromEntries(currencies.map((currency) => [currency, [0]]));
  for (let minute = 1; minute <= 65; minute += 1) {
    const usdStep = minute <= 45 ? .00018 : minute <= 55 ? .00006 : minute <= 60 ? -.00012 : -.00055;
    for (const currency of currencies) {
      const step = currency === "USD" ? usdStep : currency === "JPY" ? -usdStep * .35 : 0;
      currencyPaths[currency].push(currencyPaths[currency].at(-1) + step);
    }
  }
  const histories = Object.fromEntries(STRENGTH_PAIR_CODES.map((pairCode) => {
    const [base, quote] = pairCode.split("/");
    return [pairCode, Array.from({ length: 66 }, (_, index) => ({
      price: Math.exp(5 + currencyPaths[base][index] - currencyPaths[quote][index]),
      timestamp: index * 60,
    }))];
  }));
  const scores = [60, 15, 5, 1].map((minutes) => calculateCurrencyStrength(histories, minutes).scores.USD);
  assert.ok(scores[0] > 50, `60m USD should remain strong: ${scores}`);
  assert.ok(scores[1] < scores[0], `15m USD should weaken: ${scores}`);
  assert.ok(scores[2] < 50, `5m USD should show the reversal: ${scores}`);
  assert.ok(scores[3] < 50, `1m USD should show the latest reversal: ${scores}`);
  assert.equal(new Set(scores.map((score) => score.toFixed(4))).size, 4);
});

test("flat observations do not count against directional persistence", () => {
  const history = [
    { price: 1.0000, timestamp: 0 }, { price: 0.9999, timestamp: 10 },
    { price: 0.9999, timestamp: 20 }, { price: 0.9998, timestamp: 30 },
    { price: 0.9998, timestamp: 40 }, { price: 0.9997, timestamp: 50 },
    { price: 0.9997, timestamp: 60 },
  ];
  const signal = pairPeriodSignal(history, 1);
  assert.equal(signal.direction, -1);
  assert.equal(signal.continuation, -1);
  assert.ok(signal.quality > 0.5);
});

test("persistent 60m separation is stronger than a one-minute snapshot", () => {
  const histories = historiesFromCurrencySlopes({ USD: .000015, JPY: -.000015, EUR: .000002, GBP: 0, AUD: -.000002 });
  const s60 = calculateCurrencyStrength(histories, 60);
  const s1 = calculateCurrencyStrength(histories, 1);
  assert.ok(Math.abs(s60.pairScores["USD/JPY"]) > Math.abs(s1.pairScores["USD/JPY"]));
});
