import assert from "node:assert/strict";
import test from "node:test";
import {
  analyzeMovement,
  RAPID_NOTIFICATION_COOLDOWN_MS,
  transitionMovement,
} from "../lib/movement.ts";

function historyFromChanges(start, pipSize, changes) {
  const history = [{ price: start, timestamp: 1 }];
  let price = start;
  changes.forEach((pips, index) => {
    price += pips * pipSize;
    history.push({ price, timestamp: index + 2 });
  });
  return history;
}

function alternatingBaseline(count, pips) {
  return Array.from({ length: count }, (_, index) => (index % 2 === 0 ? pips : -pips));
}

test("rapid thresholds are learned independently from each pair's usual movement", () => {
  const quiet = analyzeMovement(historyFromChanges(0.85, 0.0001, alternatingBaseline(40, 0.2)), 0.0001);
  const active = analyzeMovement(historyFromChanges(190, 0.01, alternatingBaseline(40, 4)), 0.01);
  assert.ok(quiet);
  assert.ok(active);
  assert.ok(quiet.thresholds.rapidShort < active.thresholds.rapidShort);
  assert.equal(Number(quiet.thresholds.rapidShort.toFixed(2)), 0.5);
  assert.equal(Number(active.thresholds.rapidShort.toFixed(2)), 10);
});

test("rapid waits for 30 samples and requires magnitude, direction, and acceleration", () => {
  const insufficient = analyzeMovement(historyFromChanges(150, 0.01, [...alternatingBaseline(24, 1), ...Array(5).fill(4)]), 0.01);
  assert.equal(insufficient, null);

  const rapid = analyzeMovement(historyFromChanges(150, 0.01, [...alternatingBaseline(40, 1), ...Array(5).fill(3)]), 0.01);
  assert.ok(rapid);
  assert.equal(rapid.candidate, "RAPID_UP");
  assert.ok(Math.abs(rapid.short.netPips) >= rapid.thresholds.rapidShort);
  assert.equal(rapid.short.upCount / 5, 1);
  assert.ok(rapid.directionEfficiency >= 0.72);
  assert.ok(rapid.accelerationRatio >= 1.5);
});

test("smooth rises and falls remain trends when there is no acceleration", () => {
  const rising = analyzeMovement(historyFromChanges(150, 0.01, Array(40).fill(1)), 0.01);
  const falling = analyzeMovement(historyFromChanges(150, 0.01, Array(40).fill(-1)), 0.01);
  assert.equal(rising?.candidate, "UP_TREND");
  assert.equal(falling?.candidate, "DOWN_TREND");
  assert.equal(Number(rising?.accelerationRatio.toFixed(2)), 1);
});

test("choppy movement is not rapid even when its total path is large", () => {
  const result = analyzeMovement(historyFromChanges(150, 0.01, [
    ...alternatingBaseline(40, 1),
    8, -7, 8, -7, 8,
  ]), 0.01);
  assert.ok(result);
  assert.notEqual(result.candidate, "RAPID_UP");
  assert.notEqual(result.candidate, "RAPID_DOWN");
  assert.ok(result.directionEfficiency < 0.72);
});

test("a sharp breakout after quiet trading and temporary trend acceleration are rapid", () => {
  const breakoutUp = analyzeMovement(historyFromChanges(150, 0.01, [...alternatingBaseline(40, 1), ...Array(5).fill(3)]), 0.01);
  const breakoutDown = analyzeMovement(historyFromChanges(150, 0.01, [...alternatingBaseline(40, 1), ...Array(5).fill(-3)]), 0.01);
  const trendAcceleration = analyzeMovement(historyFromChanges(150, 0.01, [...Array(35).fill(1), ...Array(5).fill(3)]), 0.01);
  assert.equal(breakoutUp?.candidate, "RAPID_UP");
  assert.equal(breakoutDown?.candidate, "RAPID_DOWN");
  assert.equal(trendAcceleration?.candidate, "RAPID_UP");
});

test("small countertrend rebounds and pullbacks are not rapid even with a tiny median", () => {
  const declineThenBounce = analyzeMovement(historyFromChanges(95, 0.01, [
    ...Array(15).fill(-2),
    ...alternatingBaseline(25, 0.1),
    ...Array(5).fill(0.4),
  ]), 0.01);
  const riseThenPullback = analyzeMovement(historyFromChanges(95, 0.01, [
    ...Array(15).fill(2),
    ...alternatingBaseline(25, 0.1),
    ...Array(5).fill(-0.4),
  ]), 0.01);

  assert.ok(declineThenBounce?.ratioToMedian >= 2.5);
  assert.ok(riseThenPullback?.ratioToMedian >= 2.5);
  assert.notEqual(declineThenBounce?.candidate, "RAPID_UP");
  assert.notEqual(riseThenPullback?.candidate, "RAPID_DOWN");
  assert.ok(declineThenBounce.short.netPips > 0);
  assert.ok(riseThenPullback.short.netPips < 0);
});

test("an extremely small median cannot promote an ordinary quiet-market move to rapid", () => {
  const result = analyzeMovement(historyFromChanges(150, 0.01, [
    ...alternatingBaseline(10, 2),
    ...alternatingBaseline(30, 0.1),
    ...Array(5).fill(0.3),
  ]), 0.01);
  assert.ok(result);
  assert.ok(result.ratioToMedian >= 2.5);
  assert.notEqual(result.candidate, "RAPID_UP");
  assert.ok(Math.abs(result.short.netPips) < result.thresholds.percentile95FiveMove
    || Math.abs(result.short.netPips) < result.thresholds.rangeMinimum
    || Math.abs(result.short.netPips) < result.thresholds.absoluteMove90 * 5);
});

test("rapid direction always matches latest minus five-changes-ago, including AUD/JPY", () => {
  const up = analyzeMovement(historyFromChanges(92, 0.01, [...alternatingBaseline(40, 1), ...Array(5).fill(3)]), 0.01);
  const down = analyzeMovement(historyFromChanges(92, 0.01, [...alternatingBaseline(40, 1), ...Array(5).fill(-3)]), 0.01);
  assert.equal(up?.candidate, "RAPID_UP");
  assert.ok(up.latestPrice > up.startPrice);
  assert.ok(up.short.netPips > 0);
  assert.equal(down?.candidate, "RAPID_DOWN");
  assert.ok(down.latestPrice < down.startPrice);
  assert.ok(down.short.netPips < 0);
});

test("material-move filters reduce legacy relative-only rapid candidates", () => {
  const cases = [
    ...Array.from({ length: 10 }, (_, index) => [
      ...Array(15).fill(-2 - index * 0.02),
      ...alternatingBaseline(25, 0.1),
      ...Array(5).fill(0.35 + index * 0.01),
    ]),
    ...Array.from({ length: 10 }, (_, index) => [
      ...Array(15).fill(2 + index * 0.02),
      ...alternatingBaseline(25, 0.1),
      ...Array(5).fill(-(0.35 + index * 0.01)),
    ]),
    ...Array.from({ length: 5 }, (_, index) => [
      ...alternatingBaseline(40, 1),
      ...Array(5).fill(3 + index * 0.2),
    ]),
  ];
  const analyses = cases.map((changes) => analyzeMovement(historyFromChanges(95, 0.01, changes), 0.01));
  const legacyCount = analyses.filter((analysis) => analysis
    && Math.abs(analysis.short.netPips) >= analysis.thresholds.rapidShort
    && analysis.accelerationRatio >= 1.5
    && (analysis.directionEfficiency >= 0.72 || Math.max(analysis.short.upCount, analysis.short.downCount) >= 4)).length;
  const strictCount = analyses.filter((analysis) => analysis?.candidate === "RAPID_UP" || analysis?.candidate === "RAPID_DOWN").length;
  assert.equal(legacyCount, 25);
  assert.equal(strictCount, 5);
});

test("same-direction rapid notifications cool down for 90 seconds but allow a stronger burst or reversal", () => {
  const first = transitionMovement({ state: "NORMAL", normalConfirmations: 0 }, "RAPID_UP", 1_000, 1.1);
  assert.equal(first.notification, "RAPID_UP");
  const suppressed = transitionMovement(first.tracker, "RAPID_UP", 1_000 + RAPID_NOTIFICATION_COOLDOWN_MS - 1, 1.2);
  assert.equal(suppressed.notification, null);
  const stronger = transitionMovement(first.tracker, "RAPID_UP", 2_000, 1.6);
  assert.equal(stronger.notification, "RAPID_UP");
  const reverse = transitionMovement(first.tracker, "RAPID_DOWN", 2_000, 1.1);
  assert.equal(reverse.notification, "RAPID_DOWN");
  const afterCooldown = transitionMovement(first.tracker, "RAPID_UP", 1_000 + RAPID_NOTIFICATION_COOLDOWN_MS, 1.1);
  assert.equal(afterCooldown.notification, "RAPID_UP");
});
