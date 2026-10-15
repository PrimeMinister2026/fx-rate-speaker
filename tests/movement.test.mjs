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
  assert.equal(Number(quiet.thresholds.rapidShort.toFixed(2)), 2.5);
  assert.equal(Number(active.thresholds.rapidShort.toFixed(2)), 50);
});

test("rapid waits for 30 normal-movement samples and uses the full 5-change burst", () => {
  const insufficient = analyzeMovement(historyFromChanges(150, 0.01, [...alternatingBaseline(24, 1), ...Array(5).fill(4)]), 0.01);
  assert.equal(insufficient, null);

  const rapid = analyzeMovement(historyFromChanges(150, 0.01, [...alternatingBaseline(40, 1), ...Array(5).fill(3)]), 0.01);
  assert.ok(rapid);
  assert.equal(rapid.candidate, "RAPID_UP");
  assert.ok(rapid.short.absolutePips >= rapid.thresholds.rapidShort);
  assert.equal(rapid.short.upCount / 5, 1);
});

test("same-direction rapid notifications cool down for 60 seconds but allow a stronger burst or reversal", () => {
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
