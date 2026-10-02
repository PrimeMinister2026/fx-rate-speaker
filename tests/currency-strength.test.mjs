import assert from "node:assert/strict";
import test from "node:test";
import {
  STRENGTH_PAIR_CODES,
  calculateCurrencyStrength,
} from "../lib/currency-strength.ts";

const currencies = ["USD", "JPY", "EUR", "GBP", "AUD"];

function historiesFromCurrencySlopes(slopes, points = 60) {
  return Object.fromEntries(STRENGTH_PAIR_CODES.map((pairCode) => {
    const [base, quote] = pairCode.split("/");
    const pairSlope = slopes[base] - slopes[quote];
    const history = Array.from({ length: points }, (_, index) => ({
      price: Math.exp(5 + pairSlope * index),
      timestamp: index * 10_000,
    }));
    return [pairCode, history];
  }));
}

test("ten-pair strength makes strong USD and weak JPY affect multiple connecting pairs", () => {
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
  const result = calculateCurrencyStrength(histories, 30);
  assert.ok(result.scores.AUD > result.scores.USD);
  assert.ok(result.pairScores["AUD/USD"] > 0);
  assert.ok(result.pairScores["AUD/JPY"] > 0);
  assert.ok(result.pairScores["EUR/AUD"] < 0);
  assert.ok(result.pairScores["GBP/AUD"] < 0);
});

test("each window waits for its own point count and can produce a different shape", () => {
  const histories = historiesFromCurrencySlopes({ USD: .00008, JPY: -.00008, EUR: .00003, GBP: 0, AUD: -.00003 }, 30);
  assert.equal(calculateCurrencyStrength(histories, 60).ready, false);
  assert.equal(calculateCurrencyStrength(histories, 30).ready, true);
  assert.equal(calculateCurrencyStrength(histories, 15).ready, true);
  assert.equal(calculateCurrencyStrength(histories, 7).ready, true);

  for (const pairCode of STRENGTH_PAIR_CODES) {
    const [base, quote] = pairCode.split("/");
    const history = histories[pairCode];
    const recentReverse = -(({ USD: .00008, JPY: -.00008, EUR: .00003, GBP: 0, AUD: -.00003 })[base]
      - ({ USD: .00008, JPY: -.00008, EUR: .00003, GBP: 0, AUD: -.00003 })[quote]);
    for (let index = 23; index < 30; index += 1) {
      history[index].price = history[22].price * Math.exp(recentReverse * (index - 22) * 3);
    }
  }
  const long = calculateCurrencyStrength(histories, 30);
  const short = calculateCurrencyStrength(histories, 7);
  assert.notEqual(Math.sign(long.pairScores["USD/JPY"]), Math.sign(short.pairScores["USD/JPY"]));
});

test("60, 30, 15 and 7 preserve a multi-stage USD reversal instead of collapsing to one shape", () => {
  const currencyPaths = Object.fromEntries(currencies.map((currency) => [currency, [0]]));
  for (let index = 1; index < 60; index += 1) {
    const usdStep = index < 30 ? .00018 : index < 45 ? .00007 : index < 53 ? 0 : -.00032;
    for (const currency of currencies) {
      const step = currency === "USD" ? usdStep : currency === "JPY" ? -usdStep * .35 : 0;
      currencyPaths[currency].push(currencyPaths[currency].at(-1) + step);
    }
  }
  const histories = Object.fromEntries(STRENGTH_PAIR_CODES.map((pairCode) => {
    const [base, quote] = pairCode.split("/");
    return [pairCode, Array.from({ length: 60 }, (_, index) => ({
      price: Math.exp(5 + currencyPaths[base][index] - currencyPaths[quote][index]),
      timestamp: index * 10_000,
    }))];
  }));
  const scores = [60, 30, 15, 7].map((windowSize) => calculateCurrencyStrength(histories, windowSize).scores.USD);
  assert.ok(scores[0] > 50, `60 point USD should remain strong: ${scores}`);
  assert.ok(scores[1] < scores[0], `30 point USD should weaken: ${scores}`);
  assert.ok(scores[2] < 50, `15 point USD should show the reversal: ${scores}`);
  assert.ok(scores[3] < scores[2], `7 point USD should be weakest: ${scores}`);
  assert.equal(new Set(scores.map((score) => score.toFixed(4))).size, 4);
});


test("strength v2 keeps a subtle but persistent long-window currency advantage visible", () => {
  const histories = historiesFromCurrencySlopes({ USD: .000012, JPY: -.000012, EUR: .000001, GBP: 0, AUD: -.000001 }, 60);
  const result = calculateCurrencyStrength(histories, 60);
  assert.equal(result.ready, true);
  assert.ok(result.scores.USD > 55);
  assert.ok(result.scores.JPY < 45);
  assert.ok(result.pairScores["USD/JPY"] > 10);
});

test("strength v2 suppresses directionless noise compared with a clean trend", () => {
  const clean = historiesFromCurrencySlopes({ USD: .00005, JPY: -.00005, EUR: 0, GBP: 0, AUD: 0 }, 30);
  const noisy = Object.fromEntries(Object.entries(clean).map(([pairCode, history]) => [
    pairCode,
    history.map((point, index) => ({
      ...point,
      price: point.price * Math.exp(index === 0 ? 0 : (index % 2 === 0 ? .00018 : -.00018)),
    })),
  ]));
  const cleanResult = calculateCurrencyStrength(clean, 30);
  const noisyResult = calculateCurrencyStrength(noisy, 30);
  assert.ok(Math.abs(cleanResult.pairScores["USD/JPY"]) >= Math.abs(noisyResult.pairScores["USD/JPY"]));
});
