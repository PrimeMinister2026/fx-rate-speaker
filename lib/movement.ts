export const TREND_WINDOW = 5;
export const TREND_DIRECTION_COUNT = 4;
export const RAPID_SHORT_WINDOW = 5;
export const RAPID_LONG_WINDOW = 10;
export const RAPID_DIRECTION_RATIO = 0.7;

// Each pair learns its own usual tick movement from a robust rolling baseline.
export const VOLATILITY_WINDOW = 60;
export const MIN_VOLATILITY_SAMPLES = 30;
export const TREND_VOLATILITY_MULTIPLIER = 3;
export const RAPID_SHORT_NORMAL_MULTIPLIER = 2.5;
export const RAPID_LONG_NORMAL_MULTIPLIER = 2.0;
export const RAPID_NOTIFICATION_COOLDOWN_MS = 60 * 1000;
export const RAPID_STRONGER_MULTIPLIER = 1.35;

export const HISTORY_POINT_LIMIT = VOLATILITY_WINDOW + 1;
export const NORMAL_CONFIRMATIONS_REQUIRED = 2;
export const MAX_ACCEPTED_RELATIVE_CHANGE = 0.05;
const PIP_COMPARISON_EPSILON = 1e-6;

export type RatePoint = { price: number; timestamp: number };
export type MovementState = "NORMAL" | "UP_TREND" | "DOWN_TREND" | "RAPID_UP" | "RAPID_DOWN";
export type MovementNotification = Exclude<MovementState, "NORMAL">;
export type MovementTracker = {
  state: MovementState;
  normalConfirmations: number;
  lastRapidAt?: number;
  lastRapidSide?: "up" | "down";
  lastRapidIntensity?: number;
};

type WindowStats = {
  upCount: number;
  downCount: number;
  netPips: number;
  absolutePips: number;
};

export type MovementThresholds = {
  recentMove: number;
  recentRange: number;
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
  rapidIntensity: number;
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
  let absolutePips = 0;
  for (let index = 1; index < points.length; index += 1) {
    const change = points[index].price - points[index - 1].price;
    if (change > 0) upCount += 1;
    if (change < 0) downCount += 1;
    absolutePips += Math.abs(change) / pipSize;
  }
  return {
    upCount,
    downCount,
    netPips: (points.at(-1)!.price - points[0].price) / pipSize,
    absolutePips,
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
  const typical = median(moves);
  if (typical > PIP_COMPARISON_EPSILON) return typical;
  const positiveMoves = moves.filter((move) => move > PIP_COMPARISON_EPSILON);
  return positiveMoves.length ? median(positiveMoves) : null;
}

function dynamicThresholds(history: RatePoint[], pipSize: number): MovementThresholds | null {
  const recentMove = recentMovePips(history, pipSize);
  if (recentMove === null) return null;
  const points = history.slice(-(VOLATILITY_WINDOW + 1));
  const prices = points.map((point) => point.price);
  const recentRange = (Math.max(...prices) - Math.min(...prices)) / pipSize;
  const sampleCount = Math.min(history.length - 1, VOLATILITY_WINDOW);
  return {
    recentMove,
    recentRange,
    trend: recentMove * TREND_VOLATILITY_MULTIPLIER,
    rapidShort: recentMove * RAPID_SHORT_WINDOW * RAPID_SHORT_NORMAL_MULTIPLIER,
    rapidLong: recentMove * RAPID_LONG_WINDOW * RAPID_LONG_NORMAL_MULTIPLIER,
    sampleCount,
  };
}

export function analyzeMovement(history: RatePoint[], pipSize: number): MovementAnalysis | null {
  const thresholds = dynamicThresholds(history, pipSize);
  const short = windowStats(history, RAPID_SHORT_WINDOW, pipSize);
  const long = windowStats(history, RAPID_LONG_WINDOW, pipSize);
  if (!thresholds || !short || !long) return null;
  const rapidShortUp = short.absolutePips + PIP_COMPARISON_EPSILON >= thresholds.rapidShort
    && short.netPips > 0
    && short.upCount / RAPID_SHORT_WINDOW >= RAPID_DIRECTION_RATIO;
  const rapidShortDown = short.absolutePips + PIP_COMPARISON_EPSILON >= thresholds.rapidShort
    && short.netPips < 0
    && short.downCount / RAPID_SHORT_WINDOW >= RAPID_DIRECTION_RATIO;
  const rapidLongUp = long.absolutePips + PIP_COMPARISON_EPSILON >= thresholds.rapidLong
    && long.netPips > 0
    && long.upCount / RAPID_LONG_WINDOW >= RAPID_DIRECTION_RATIO;
  const rapidLongDown = long.absolutePips + PIP_COMPARISON_EPSILON >= thresholds.rapidLong
    && long.netPips < 0
    && long.downCount / RAPID_LONG_WINDOW >= RAPID_DIRECTION_RATIO;

  let candidate: MovementState = "NORMAL";
  if (rapidShortUp || rapidLongUp) candidate = "RAPID_UP";
  else if (rapidShortDown || rapidLongDown) candidate = "RAPID_DOWN";
  else if (short.upCount >= TREND_DIRECTION_COUNT
    && short.netPips + PIP_COMPARISON_EPSILON >= thresholds.trend) candidate = "UP_TREND";
  else if (short.downCount >= TREND_DIRECTION_COUNT
    && short.netPips - PIP_COMPARISON_EPSILON <= -thresholds.trend) candidate = "DOWN_TREND";
  const rapidIntensity = Math.max(
    short.absolutePips / thresholds.rapidShort,
    long.absolutePips / thresholds.rapidLong,
  );
  return { candidate, short, long, thresholds, rapidIntensity };
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

export function transitionMovement(
  tracker: MovementTracker,
  candidate: MovementState,
  now = Date.now(),
  rapidIntensity = 0,
): {
  tracker: MovementTracker;
  notification: MovementNotification | null;
} {
  if (candidate === "NORMAL") {
    const confirmations = tracker.normalConfirmations + 1;
    return confirmations >= NORMAL_CONFIRMATIONS_REQUIRED
      ? { tracker: { state: "NORMAL", normalConfirmations: 0 }, notification: null }
      : { tracker: { ...tracker, normalConfirmations: confirmations }, notification: null };
  }
  if (candidate === "RAPID_UP" || candidate === "RAPID_DOWN") {
    const rapidSide = side(candidate) as "up" | "down";
    const sameDirection = tracker.lastRapidSide === rapidSide;
    const inCooldown = sameDirection
      && now - (tracker.lastRapidAt ?? 0) < RAPID_NOTIFICATION_COOLDOWN_MS;
    const materiallyStronger = rapidIntensity >= (tracker.lastRapidIntensity ?? 0) * RAPID_STRONGER_MULTIPLIER;
    const notification = !inCooldown || !sameDirection || materiallyStronger ? candidate : null;
    return {
      tracker: {
        ...tracker,
        state: candidate,
        normalConfirmations: 0,
        ...(notification ? {
          lastRapidAt: now,
          lastRapidSide: rapidSide,
          lastRapidIntensity: rapidIntensity,
        } : {}),
      },
      notification,
    };
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
