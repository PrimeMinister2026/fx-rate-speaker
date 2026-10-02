export const TREND_WINDOW = 5;
export const TREND_DIRECTION_COUNT = 4;
export const RAPID_SHORT_WINDOW = 5;
export const RAPID_LONG_WINDOW = 10;
export const RAPID_DIRECTION_RATIO = 0.6;

// Dynamic thresholds are based on each pair's own recent absolute moves.
export const VOLATILITY_WINDOW = 25;
export const MIN_VOLATILITY_SAMPLES = 20;
export const TREND_VOLATILITY_MULTIPLIER = 3;
export const RAPID_SHORT_VOLATILITY_MULTIPLIER = 6;
export const RAPID_LONG_VOLATILITY_MULTIPLIER = 12;
export const JPY_RECENT_MOVE_MIN_PIPS = 0.2;
export const JPY_RECENT_MOVE_MAX_PIPS = 5;
export const NON_JPY_RECENT_MOVE_MIN_PIPS = 0.2;
export const NON_JPY_RECENT_MOVE_MAX_PIPS = 4;

export const HISTORY_POINT_LIMIT = VOLATILITY_WINDOW + 1;
export const NORMAL_CONFIRMATIONS_REQUIRED = 2;
export const MAX_ACCEPTED_RELATIVE_CHANGE = 0.05;
const PIP_COMPARISON_EPSILON = 1e-6;

export type RatePoint = { price: number; timestamp: number };
export type MovementState = "NORMAL" | "UP_TREND" | "DOWN_TREND" | "RAPID_UP" | "RAPID_DOWN";
export type MovementNotification = Exclude<MovementState, "NORMAL">;
export type MovementTracker = { state: MovementState; normalConfirmations: number };

type WindowStats = {
  upCount: number;
  downCount: number;
  netPips: number;
};

export type MovementThresholds = {
  recentMove: number;
  trend: number;
  rapidShort: number;
  rapidLong: number;
  sampleCount: number;
};

export type MovementAnalysis = {
  candidate: MovementState;
  short: WindowStats;
  long: WindowStats;
  thresholds: MovementThresholds;
};

export function appendRatePoint(history: RatePoint[], point: RatePoint) {
  if (!Number.isFinite(point.price) || point.price <= 0 || !Number.isFinite(point.timestamp) || point.timestamp <= 0) {
    return { history, accepted: false };
  }
  const previous = history.at(-1);
  if (previous) {
    if (point.timestamp < previous.timestamp) return { history, accepted: false };
    if (point.timestamp === previous.timestamp && point.price === previous.price) return { history, accepted: false };
    if (Math.abs(point.price - previous.price) / previous.price > MAX_ACCEPTED_RELATIVE_CHANGE) {
      return { history, accepted: false };
    }
  }
  return { history: [...history, point].slice(-HISTORY_POINT_LIMIT), accepted: true };
}

function windowStats(history: RatePoint[], window: number, pipSize: number): WindowStats | null {
  if (history.length < window + 1) return null;
  const points = history.slice(-(window + 1));
  let upCount = 0;
  let downCount = 0;
  for (let index = 1; index < points.length; index += 1) {
    if (points[index].price > points[index - 1].price) upCount += 1;
    if (points[index].price < points[index - 1].price) downCount += 1;
  }
  return {
    upCount,
    downCount,
    netPips: (points.at(-1)!.price - points[0].price) / pipSize,
  };
}

function median(values: number[]) {
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2;
}

export function recentMovePips(history: RatePoint[], pipSize: number, minimumSamples = MIN_VOLATILITY_SAMPLES): number | null {
  const points = history.slice(-(VOLATILITY_WINDOW + 1));
  const moves = points.slice(1).map((point, index) => Math.abs(point.price - points[index].price) / pipSize);
  if (moves.length < minimumSamples) return null;
  const isJpyPair = pipSize === 0.01;
  const minimum = isJpyPair ? JPY_RECENT_MOVE_MIN_PIPS : NON_JPY_RECENT_MOVE_MIN_PIPS;
  const maximum = isJpyPair ? JPY_RECENT_MOVE_MAX_PIPS : NON_JPY_RECENT_MOVE_MAX_PIPS;
  return Math.min(maximum, Math.max(minimum, median(moves)));
}

function dynamicThresholds(history: RatePoint[], pipSize: number): MovementThresholds | null {
  const recentMove = recentMovePips(history, pipSize);
  if (recentMove === null) return null;
  const sampleCount = Math.min(history.length - 1, VOLATILITY_WINDOW);
  return {
    recentMove,
    trend: recentMove * TREND_VOLATILITY_MULTIPLIER,
    rapidShort: recentMove * RAPID_SHORT_VOLATILITY_MULTIPLIER,
    rapidLong: recentMove * RAPID_LONG_VOLATILITY_MULTIPLIER,
    sampleCount,
  };
}

export function analyzeMovement(history: RatePoint[], pipSize: number): MovementAnalysis | null {
  const thresholds = dynamicThresholds(history, pipSize);
  const short = windowStats(history, RAPID_SHORT_WINDOW, pipSize);
  const long = windowStats(history, RAPID_LONG_WINDOW, pipSize);
  if (!thresholds || !short || !long) return null;
  const rapidShortUp = short.netPips + PIP_COMPARISON_EPSILON >= thresholds.rapidShort
    && short.upCount / RAPID_SHORT_WINDOW >= RAPID_DIRECTION_RATIO;
  const rapidShortDown = short.netPips - PIP_COMPARISON_EPSILON <= -thresholds.rapidShort
    && short.downCount / RAPID_SHORT_WINDOW >= RAPID_DIRECTION_RATIO;
  const rapidLongUp = long.netPips + PIP_COMPARISON_EPSILON >= thresholds.rapidLong
    && long.upCount / RAPID_LONG_WINDOW >= RAPID_DIRECTION_RATIO;
  const rapidLongDown = long.netPips - PIP_COMPARISON_EPSILON <= -thresholds.rapidLong
    && long.downCount / RAPID_LONG_WINDOW >= RAPID_DIRECTION_RATIO;

  let candidate: MovementState = "NORMAL";
  if (rapidShortUp || rapidLongUp) candidate = "RAPID_UP";
  else if (rapidShortDown || rapidLongDown) candidate = "RAPID_DOWN";
  else if (short.upCount >= TREND_DIRECTION_COUNT
    && short.netPips + PIP_COMPARISON_EPSILON >= thresholds.trend) candidate = "UP_TREND";
  else if (short.downCount >= TREND_DIRECTION_COUNT
    && short.netPips - PIP_COMPARISON_EPSILON <= -thresholds.trend) candidate = "DOWN_TREND";
  return { candidate, short, long, thresholds };
}

function side(state: MovementState) {
  if (state === "UP_TREND" || state === "RAPID_UP") return "up";
  if (state === "DOWN_TREND" || state === "RAPID_DOWN") return "down";
  return "normal";
}

function strength(state: MovementState) {
  if (state === "RAPID_UP" || state === "RAPID_DOWN") return 2;
  if (state === "UP_TREND" || state === "DOWN_TREND") return 1;
  return 0;
}

export function transitionMovement(tracker: MovementTracker, candidate: MovementState): {
  tracker: MovementTracker;
  notification: MovementNotification | null;
} {
  if (candidate === "NORMAL") {
    const confirmations = tracker.normalConfirmations + 1;
    return confirmations >= NORMAL_CONFIRMATIONS_REQUIRED
      ? { tracker: { state: "NORMAL", normalConfirmations: 0 }, notification: null }
      : { tracker: { ...tracker, normalConfirmations: confirmations }, notification: null };
  }
  if (candidate === tracker.state) {
    return { tracker: { state: candidate, normalConfirmations: 0 }, notification: null };
  }
  const isSameSideDowngrade = side(candidate) === side(tracker.state)
    && strength(candidate) < strength(tracker.state);
  return {
    tracker: { state: candidate, normalConfirmations: 0 },
    notification: isSameSideDowngrade ? null : candidate,
  };
}
