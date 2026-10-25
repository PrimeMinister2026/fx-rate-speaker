import type { MovementState, RatePoint } from "./movement";

export const MODE5_AUDIO_WINDOWS_MINUTES = [5, 3, 1] as const;
export const MODE5_GRAPH_WINDOW_SECONDS = 30 * 60;
export const MODE5_GRAPH_SAMPLE_SECONDS = 20;
export const MODE5_RAPID_BASELINE_MINUTES = 20;
export const MODE5_RAPID_PERCENTILE = 0.95;
export const MODE5_RAPID_MEDIAN_MULTIPLIER = 2.5;
export const MODE5_RAPID_EFFICIENCY = 0.72;
export const MODE5_RAPID_ACCELERATION = 1.5;
export const MODE5_RAPID_RANGE_RATIO = 0.12;
const EPSILON = 1e-9;
const TARGET_TOLERANCE_SECONDS = 45;

export type WindowDirection = "up" | "down" | "unchanged";
export type TimeWindowSnapshot = {
  minutes: 5 | 3 | 1;
  ready: boolean;
  direction: WindowDirection;
  netPips: number;
  absolutePips: number;
  efficiency: number;
  persistence: number;
  strength: number;
  startTimestamp: number | null;
  endTimestamp: number | null;
};

export type Mode5ToneCue = {
  minutes: 5 | 3 | 1;
  direction: WindowDirection;
  intensity: "flat" | "normal" | "strong";
  frequencies: [number, number, number, number];
};

export type Mode5RapidAnalysis = {
  candidate: MovementState;
  intensity: number;
  windows: TimeWindowSnapshot[];
  medianOneMinute: number;
  percentileOneMinute: number;
  rangeFiveMinutes: number;
  rangeRatio: number;
  accelerationRatio: number;
};

function clamp(value: number, minimum = 0, maximum = 1) {
  return Math.min(maximum, Math.max(minimum, value));
}

function median(values: number[]) {
  if (!values.length) return 0;
  const sorted = [...values].sort((left, right) => left - right);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2;
}

function percentile(values: number[], quantile: number) {
  if (!values.length) return 0;
  const sorted = [...values].sort((left, right) => left - right);
  const position = (sorted.length - 1) * quantile;
  const lower = Math.floor(position);
  const upper = Math.ceil(position);
  if (lower === upper) return sorted[lower];
  return sorted[lower] + (sorted[upper] - sorted[lower]) * (position - lower);
}

function sortedValid(history: RatePoint[]) {
  return history
    .filter((point) => Number.isFinite(point.price) && point.price > 0 && Number.isFinite(point.timestamp))
    .sort((left, right) => left.timestamp - right.timestamp);
}

function closestPoint(points: RatePoint[], target: number) {
  let closest: RatePoint | null = null;
  let distance = Number.POSITIVE_INFINITY;
  for (const point of points) {
    const nextDistance = Math.abs(point.timestamp - target);
    if (nextDistance < distance) {
      closest = point;
      distance = nextDistance;
    }
  }
  return distance <= TARGET_TOLERANCE_SECONDS ? closest : null;
}

export function timeWindowSnapshot(
  history: RatePoint[],
  minutes: 5 | 3 | 1,
  pipSize: number,
): TimeWindowSnapshot {
  const points = sortedValid(history);
  const latest = points.at(-1);
  const empty: TimeWindowSnapshot = {
    minutes,
    ready: false,
    direction: "unchanged",
    netPips: 0,
    absolutePips: 0,
    efficiency: 0,
    persistence: 0,
    strength: 0,
    startTimestamp: null,
    endTimestamp: latest?.timestamp ?? null,
  };
  if (!latest || !Number.isFinite(pipSize) || pipSize <= 0) return empty;
  const start = closestPoint(points, latest.timestamp - minutes * 60);
  if (!start || start.timestamp >= latest.timestamp) return empty;
  const period = points.filter((point) => point.timestamp >= start.timestamp && point.timestamp <= latest.timestamp);
  if (period.length < 3) return empty;
  const changes = period.slice(1).map((point, index) => (point.price - period[index].price) / pipSize);
  const netPips = (latest.price - start.price) / pipSize;
  const absolutePips = changes.reduce((sum, value) => sum + Math.abs(value), 0);
  const nonZero = changes.filter((value) => Math.abs(value) > EPSILON);
  const direction = netPips > EPSILON ? "up" : netPips < -EPSILON ? "down" : "unchanged";
  const aligned = nonZero.filter((value) => direction === "up" ? value > 0 : direction === "down" ? value < 0 : false).length;
  const efficiency = absolutePips > EPSILON ? Math.abs(netPips) / absolutePips : 0;
  const persistence = nonZero.length ? aligned / nonZero.length : 0;
  const typicalMove = median(changes.map(Math.abs).filter((value) => value > EPSILON));
  const expectedNoise = typicalMove * Math.sqrt(changes.length);
  const normalizedMagnitude = expectedNoise > EPSILON ? Math.abs(netPips) / expectedNoise : 0;
  const strength = clamp((normalizedMagnitude / 3) * 0.55 + efficiency * 0.25 + persistence * 0.20);
  const neutral = normalizedMagnitude < 0.65 || (efficiency < 0.18 && persistence < 0.58);
  return {
    minutes,
    ready: true,
    direction: neutral ? "unchanged" : direction,
    netPips,
    absolutePips,
    efficiency,
    persistence,
    strength,
    startTimestamp: start.timestamp,
    endTimestamp: latest.timestamp,
  };
}

export function mode5AudioWindows(history: RatePoint[], pipSize: number) {
  return MODE5_AUDIO_WINDOWS_MINUTES.map((minutes) => timeWindowSnapshot(history, minutes, pipSize));
}

export function buildMode5ToneCues(history: RatePoint[], pipSize: number): Mode5ToneCue[] {
  const windows = mode5AudioWindows(history, pipSize);
  const baseFrequency = 660;
  return windows.filter((window) => window.ready).map((window) => {
    const direction = window.direction === "unchanged" || window.strength < 0.30
      ? "unchanged"
      : window.direction;
    const intensity = direction === "unchanged" ? "flat" : window.strength >= 0.72 ? "strong" : "normal";
    const intervalSemitones = intensity === "strong" ? 7 : intensity === "normal" ? 3 : 0;
    const frequencyAt = (semitones: number) => baseFrequency * (2 ** (semitones / 12));
    const ascending: [number, number, number, number] = intervalSemitones === 0
      ? [baseFrequency, baseFrequency, baseFrequency, baseFrequency]
      : [
        frequencyAt(-intervalSemitones / 2),
        frequencyAt(-intervalSemitones / 6),
        frequencyAt(intervalSemitones / 6),
        frequencyAt(intervalSemitones / 2),
      ];
    return {
      minutes: window.minutes,
      direction,
      intensity,
      frequencies: direction === "up"
        ? ascending
        : direction === "down" ? [...ascending].reverse() as [number, number, number, number] : ascending,
    };
  });
}

function rollingOneMinuteMoves(points: RatePoint[], pipSize: number, latestTimestamp: number) {
  const baselineEnd = latestTimestamp - 60;
  const baselineStart = latestTimestamp - MODE5_RAPID_BASELINE_MINUTES * 60;
  const candidates = points.filter((point) => point.timestamp >= baselineStart && point.timestamp <= baselineEnd);
  const moves: number[] = [];
  for (const end of candidates) {
    const start = closestPoint(points, end.timestamp - 60);
    if (start && start.timestamp < end.timestamp && end.timestamp <= baselineEnd) {
      moves.push(Math.abs(end.price - start.price) / pipSize);
    }
  }
  return moves;
}

export function analyzeMode5Rapid(history: RatePoint[], pipSize: number): Mode5RapidAnalysis | null {
  const points = sortedValid(history);
  const windows = mode5AudioWindows(points, pipSize);
  const five = windows[0];
  const three = windows[1];
  const one = windows[2];
  const latest = points.at(-1);
  if (!latest || windows.some((window) => !window.ready)) return null;
  const baseline = rollingOneMinuteMoves(points, pipSize, latest.timestamp);
  if (baseline.length < 12) return null;
  const medianOneMinute = median(baseline);
  const percentileOneMinute = percentile(baseline, MODE5_RAPID_PERCENTILE);
  const fiveMinutePoints = points.filter((point) => point.timestamp >= latest.timestamp - 5 * 60);
  const prices = fiveMinutePoints.map((point) => point.price);
  const rangeFiveMinutes = prices.length
    ? (Math.max(...prices) - Math.min(...prices)) / pipSize
    : 0;
  const rangeRatio = rangeFiveMinutes > EPSILON ? Math.abs(one.netPips) / rangeFiveMinutes : 0;
  const precedingThreeRate = Math.abs(three.netPips - one.netPips) / 2;
  const accelerationRatio = precedingThreeRate > EPSILON
    ? Math.abs(one.netPips) / precedingThreeRate
    : Math.abs(one.netPips) > EPSILON ? Number.POSITIVE_INFINITY : 0;
  const direction = Math.sign(one.netPips);
  const alignedThree = Math.sign(three.netPips) === direction;
  const alignedFive = Math.sign(five.netPips) === direction;
  const counterTrendIsLarge = Math.abs(one.netPips) >= Math.max(Math.abs(three.netPips) * 0.8, percentileOneMinute * 1.35);
  const contextConfirmed = alignedThree || alignedFive || counterTrendIsLarge;
  const magnitudeConfirmed = Math.abs(one.netPips) + EPSILON >= medianOneMinute * MODE5_RAPID_MEDIAN_MULTIPLIER
    && Math.abs(one.netPips) + EPSILON >= percentileOneMinute
    && rangeRatio + EPSILON >= MODE5_RAPID_RANGE_RATIO;
  const directional = one.efficiency >= MODE5_RAPID_EFFICIENCY && one.persistence >= 0.70;
  const accelerated = accelerationRatio + EPSILON >= MODE5_RAPID_ACCELERATION;
  const isRapid = direction !== 0 && magnitudeConfirmed && directional && accelerated && contextConfirmed;
  const candidate: MovementState = isRapid
    ? direction > 0 ? "RAPID_UP" : "RAPID_DOWN"
    : five.direction === "up" && three.direction !== "down" ? "UP_TREND"
      : five.direction === "down" && three.direction !== "up" ? "DOWN_TREND"
        : "NORMAL";
  const intensity = isRapid
    ? Math.sqrt(
      (Math.abs(one.netPips) / Math.max(percentileOneMinute, EPSILON))
      * (accelerationRatio / MODE5_RAPID_ACCELERATION),
    )
    : 0;
  return {
    candidate,
    intensity,
    windows,
    medianOneMinute,
    percentileOneMinute,
    rangeFiveMinutes,
    rangeRatio,
    accelerationRatio,
  };
}

export function sampleThirtyMinuteGraph(history: RatePoint[], nowSeconds: number) {
  const start = nowSeconds - MODE5_GRAPH_WINDOW_SECONDS;
  const filtered = sortedValid(history).filter((point) => point.timestamp >= start && point.timestamp <= nowSeconds);
  const buckets = new Map<number, RatePoint>();
  filtered.forEach((point) => buckets.set(Math.floor(point.timestamp / MODE5_GRAPH_SAMPLE_SECONDS), point));
  return [...buckets.values()].sort((left, right) => left.timestamp - right.timestamp);
}

export function threeMinuteGridLines(nowSeconds: number) {
  const start = nowSeconds - MODE5_GRAPH_WINDOW_SECONDS;
  const first = Math.ceil(start / 180) * 180;
  const lines: Array<{ timestamp: number; major: boolean }> = [];
  for (let timestamp = first; timestamp <= nowSeconds; timestamp += 180) {
    lines.push({ timestamp, major: timestamp % 900 === 0 });
  }
  return lines;
}
