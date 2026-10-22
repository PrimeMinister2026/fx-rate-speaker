import assert from "node:assert/strict";
import test from "node:test";
import {
  analyzeMode5Rapid,
  buildMode5ToneCues,
  mode5AudioWindows,
  sampleThirtyMinuteGraph,
  threeMinuteGridLines,
} from "../lib/mode5-market.ts";

function seriesFromChanges(changes, start = 150, pipSize = 0.01, spacing = 10) {
  let price = start;
  return [{ price, timestamp: 1_000_000 }].concat(changes.map((change, index) => {
    price += change * pipSize;
    return { price, timestamp: 1_000_000 + (index + 1) * spacing };
  }));
}

test("audio windows are ordered 5m, 3m, 1m and use timestamps rather than indexes", () => {
  const history = seriesFromChanges(Array(150).fill(0.2));
  const withGap = history.filter((_, index) => index % 7 !== 0);
  const windows = mode5AudioWindows(withGap, 0.01);
  assert.deepEqual(windows.map((window) => window.minutes), [5, 3, 1]);
  assert.ok(windows.every((window) => window.ready));
  assert.ok(windows.every((window) => window.direction === "up"));
  assert.ok(windows.every((window) => Math.abs((window.endTimestamp - window.startTimestamp) - window.minutes * 60) <= 45));
  const cues = buildMode5ToneCues(withGap, 0.01);
  assert.deepEqual(cues.map((cue) => cue.minutes), [5, 3, 1]);
  assert.ok(cues.every((cue) => cue.direction === "up"));
  assert.ok(cues.every((cue) => cue.frequencies[0] < cue.frequencies[1]));
});

test("mode 5 uses symmetric two-note direction cues and widens strong moves", () => {
  const flat = seriesFromChanges(Array(150).fill(0));
  const normal = seriesFromChanges(Array.from({ length: 150 }, (_, index) => index % 4 === 0 ? -0.15 : 0.25));
  const strong = seriesFromChanges(Array(150).fill(0.8));
  const flatCues = buildMode5ToneCues(flat, 0.01);
  const normalCue = buildMode5ToneCues(normal, 0.01).at(-1);
  const strongCue = buildMode5ToneCues(strong, 0.01).at(-1);
  assert.ok(flatCues.every((cue) => cue.direction === "unchanged" && cue.frequencies[0] === cue.frequencies[1]));
  assert.ok(normalCue && strongCue);
  assert.ok(strongCue.frequencies[1] / strongCue.frequencies[0] > normalCue.frequencies[1] / normalCue.frequencies[0]);
});

test("mode 5 emits only ready time-window cues without legacy fallback", () => {
  const twoMinutes = seriesFromChanges(Array(12).fill(0.4));
  const cues = buildMode5ToneCues(twoMinutes, 0.01);
  assert.deepEqual(cues.map((cue) => cue.minutes), [1]);
});

test("small countertrend moves do not become rapid", () => {
  const decline = Array(105).fill(-0.35);
  const smallBounce = Array(6).fill(0.18);
  const analysis = analyzeMode5Rapid(seriesFromChanges([...decline, ...smallBounce]), 0.01);
  assert.ok(analysis);
  assert.notEqual(analysis.candidate, "RAPID_UP");
});

test("a genuine accelerated one-minute breakout becomes rapid", () => {
  const quiet = Array.from({ length: 120 }, (_, index) => index % 2 === 0 ? 0.12 : -0.1);
  const surge = Array(6).fill(2.4);
  const analysis = analyzeMode5Rapid(seriesFromChanges([...quiet, ...surge]), 0.01);
  assert.ok(analysis);
  assert.equal(analysis.candidate, "RAPID_UP");
  assert.ok(analysis.accelerationRatio >= 1.5);
  assert.ok(analysis.rangeRatio >= 0.12);
});

test("the 30-minute graph is drawing-only 20-second sampling and keeps the current right edge", () => {
  const history = seriesFromChanges(Array(240).fill(0.1));
  const now = history.at(-1).timestamp;
  const sampled = sampleThirtyMinuteGraph(history, now);
  assert.ok(sampled.length >= 89 && sampled.length <= 91);
  assert.equal(sampled.at(-1).timestamp, now);
  assert.ok(sampled[0].timestamp >= now - 1800);
});

test("three-minute grid is timestamp-aligned and quarter-hours are major", () => {
  const now = 1_800_123;
  const lines = threeMinuteGridLines(now);
  assert.ok(lines.length >= 9 && lines.length <= 11);
  assert.ok(lines.every((line) => line.timestamp % 180 === 0));
  assert.ok(lines.some((line) => line.major && line.timestamp % 900 === 0));
  assert.ok(lines.some((line) => !line.major));
});
