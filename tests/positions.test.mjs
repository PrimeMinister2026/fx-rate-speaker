import assert from "node:assert/strict";
import test from "node:test";
import { calculatePositionPips, positionPipsSpeech, restorePositions } from "../lib/positions.ts";

test("JPY BUY and SELL positions calculate profit and loss", () => {
  assert.equal(calculatePositionPips({ pair: "USD/JPY", side: "BUY", entryPrice: 158.320 }, 158.333, true), 1.3);
  assert.equal(calculatePositionPips({ pair: "USD/JPY", side: "BUY", entryPrice: 158.320 }, 158.310, true), -1);
  assert.equal(calculatePositionPips({ pair: "USD/JPY", side: "SELL", entryPrice: 158.350 }, 158.333, true), 1.7);
  assert.equal(calculatePositionPips({ pair: "USD/JPY", side: "SELL", entryPrice: 158.350 }, 158.360, true), -1);
});

test("non-JPY BUY and SELL positions use a 0.0001 pip", () => {
  assert.equal(calculatePositionPips({ pair: "EUR/USD", side: "BUY", entryPrice: 1.08520 }, 1.08535, false), 1.5);
  assert.equal(calculatePositionPips({ pair: "EUR/USD", side: "SELL", entryPrice: 1.08550 }, 1.08535, false), 1.5);
});

test("position speech rounds to one decimal and omits the pips suffix", () => {
  assert.equal(positionPipsSpeech(1.34), "プラス1.3");
  assert.equal(positionPipsSpeech(-2.87), "マイナス2.9");
  assert.equal(positionPipsSpeech(-0), "0.0");
  assert.doesNotMatch(positionPipsSpeech(3.2), /ピップス/);
});

test("saved positions restore independently and invalid entries are removed", () => {
  const restored = restorePositions(JSON.stringify({
    "USD/JPY": { pair: "USD/JPY", side: "BUY", entryPrice: 158.32 },
    "EUR/USD": { pair: "EUR/USD", side: "SELL", entryPrice: 1.0852 },
    "BAD/PAIR": { pair: "BAD/PAIR", side: "BUY", entryPrice: 1 },
    "GBP/JPY": { pair: "GBP/JPY", side: "NONE", entryPrice: 200 },
  }), ["USD/JPY", "EUR/USD", "GBP/JPY"]);
  assert.deepEqual(Object.keys(restored).sort(), ["EUR/USD", "USD/JPY"]);
  assert.equal(restored["USD/JPY"].side, "BUY");
  assert.equal(restored["EUR/USD"].side, "SELL");
  assert.deepEqual(restorePositions("broken", ["USD/JPY"]), {});
});
