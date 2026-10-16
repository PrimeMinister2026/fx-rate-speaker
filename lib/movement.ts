export const TREND_WINDOW = 5;
export const TREND_DIRECTION_COUNT = 4;
export const RAPID_SHORT_WINDOW = 5;
export const RAPID_LONG_WINDOW = 10;
export const RAPID_DIRECTION_EFFICIENCY = 0.72;
export const RAPID_DIRECTION_COUNT = 4;
export const RAPID_ACCELERATION_WINDOW = 3;
export const RAPID_ACCELERATION_BASELINE_WINDOW = 10;

// Each pair learns its own usual tick movement from a robust rolling baseline.
export const VOLATILITY_WINDOW = 60;
export const MIN_VOLATILITY_SAMPLES = 30;
export const TREND_VOLATILITY_MULTIPLIER = 3;
export const RAPID_FIVE_WINDOW_MULTIPLIER = 2.5;
export const RAPID_ACCELERATION_MULTIPLIER = 1.5;
export const RAPID_FIVE_WINDOW_PERCENTILE = 0.95;
export const RAPID_ABSOLUTE_MOVE_PERCENTILE = 0.90;
export const RAPID_RANGE_RATIO = 0.15;
export const RAPID_NOTIFICATION_COOLDOWN_MS = 90 * 1000;
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
  medianFiveMove: number;
  percentile90FiveMove: number;
  percentile95FiveMove: number;
  absoluteMove90: number;
  rangeMinimum: number;
  sampleCount: number;
};

export type MovementAnalysis = {
  candidate: MovementState;
  short: WindowStats;
  long: WindowStats;
  thresholds: MovementThresholds;
  directionEfficiency: number;
  accelerationRatio: number;
  startPrice: number;
  latestPrice: number;
  ratioToMedian: number;
  percentile5: number;
  rangeRatio: number;
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

function percentile(values: number[], quantile: number) {
  if (!values.length) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const position = (sorted.length - 1) * quantile;
  const lower = Math.floor(position);
  const upper = Math.ceil(position);
  if (lower === upper) return sorted[lower];
  return sorted[lower] + (sorted[upper] - sorted[lower]) * (position - lower);
}

function percentileRank(values: number[], value: number) {
  if (!values.length) return 0;
  return values.filter((candidate) => candidate <= value + PIP_COMPARISON_EPSILON).length / values.length * 100;
}

function signedChanges(history: RatePoint[], pipSize: number) {
  return history.slice(1).map((point, index) => (point.price - history[index].price) / pipSize);
}

function historicalMovementDistribution(history: RatePoint[], pipSize: number) {
  // Keep the current five-change candidate completely outside its own baseline.
  const baselinePoints = history.slice(-(VOLATILITY_WINDOW + 1), -RAPID_SHORT_WINDOW);
  if (baselinePoints.length < RAPID_SHORT_WINDOW + 1) return null;
  const fiveMoves: number[] = [];
  for (let end = RAPID_SHORT_WINDOW; end < baselinePoints.length; end += 1) {
    fiveMoves.push(Math.abs(baselinePoints[end].price - baselinePoints[end - RAPID_SHORT_WINDOW].price) / pipSize);
  }
  const absoluteMoves = baselinePoints.slice(1)
    .map((point, index) => Math.abs(point.price - baselinePoints[index].price) / pipSize);
  return { fiveMoves, absoluteMoves };
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
  const distribution = historicalMovementDistribution(history, pipSize);
  if (!distribution) return null;
  const medianFiveMove = median(distribution.fiveMoves);
  const percentile90FiveMove = percentile(distribution.fiveMoves, 0.90);
  const percentile95FiveMove = percentile(distribution.fiveMoves, RAPID_FIVE_WINDOW_PERCENTILE);
  const absoluteMove90 = percentile(distribution.absoluteMoves, RAPID_ABSOLUTE_MOVE_PERCENTILE);
  return {
    recentMove,
    recentRange,
    trend: recentMove * TREND_VOLATILITY_MULTIPLIER,
    rapidShort: medianFiveMove * RAPID_FIVE_WINDOW_MULTIPLIER,
    medianFiveMove,
    percentile90FiveMove,
    percentile95FiveMove,
    absoluteMove90,
    rangeMinimum: recentRange * RAPID_RANGE_RATIO,
    sampleCount,
  };
}

export function analyzeMovement(history: RatePoint[], pipSize: number): MovementAnalysis | null {
  const thresholds = dynamicThresholds(history, pipSize);
  const short = windowStats(history, RAPID_SHORT_WINDOW, pipSize);
  const long = windowStats(history, RAPID_LONG_WINDOW, pipSize);
  if (!thresholds || !short || !long) return null;
  const changes = signedChanges(history.slice(-(VOLATILITY_WINDOW + 1)), pipSize);
  const recentAccelerationMoves = changes.slice(-RAPID_ACCELERATION_WINDOW);
  const precedingMoves = changes.slice(
    -(RAPID_ACCELERATION_WINDOW + RAPID_ACCELERATION_BASELINE_WINDOW),
    -RAPID_ACCELERATION_WINDOW,
  );
  const recentAccelerationAverage = recentAccelerationMoves.reduce((sum, value) => sum + Math.abs(value), 0)
    / RAPID_ACCELERATION_WINDOW;
  const precedingAverage = precedingMoves.reduce((sum, value) => sum + Math.abs(value), 0)
    / RAPID_ACCELERATION_BASELINE_WINDOW;
  const accelerationRatio = precedingAverage > PIP_COMPARISON_EPSILON
    ? recentAccelerationAverage / precedingAverage
    : recentAccelerationAverage > PIP_COMPARISON_EPSILON ? Number.POSITIVE_INFINITY : 0;
  const directionEfficiency = short.absolutePips > PIP_COMPARISON_EPSILON
    ? Math.abs(short.netPips) / short.absolutePips
    : 0;
  const directionalUp = directionEfficiency >= RAPID_DIRECTION_EFFICIENCY
    || short.upCount >= RAPID_DIRECTION_COUNT;
  const directionalDown = directionEfficiency >= RAPID_DIRECTION_EFFICIENCY
    || short.downCount >= RAPID_DIRECTION_COUNT;
  const netMagnitude = Math.abs(short.netPips);
  const ratioToMedian = thresholds.medianFiveMove > PIP_COMPARISON_EPSILON
    ? netMagnitude / thresholds.medianFiveMove
    : netMagnitude > PIP_COMPARISON_EPSILON ? Number.POSITIVE_INFINITY : 0;
  const percentile5 = percentileRank(
    historicalMovementDistribution(history, pipSize)?.fiveMoves ?? [],
    netMagnitude,
  );
  const rangeRatio = thresholds.recentRange > PIP_COMPARISON_EPSILON
    ? netMagnitude / thresholds.recentRange
    : 0;
  const rapidMagnitude = netMagnitude + PIP_COMPARISON_EPSILON >= thresholds.rapidShort
    && netMagnitude + PIP_COMPARISON_EPSILON >= thresholds.percentile95FiveMove
    && netMagnitude + PIP_COMPARISON_EPSILON >= thresholds.absoluteMove90 * RAPID_SHORT_WINDOW
    && netMagnitude + PIP_COMPARISON_EPSILON >= thresholds.rangeMinimum;
  const accelerated = accelerationRatio + PIP_COMPARISON_EPSILON >= RAPID_ACCELERATION_MULTIPLIER;
  const rapidShortUp = rapidMagnitude && accelerated && directionalUp && short.netPips > 0;
  const rapidShortDown = rapidMagnitude && accelerated && directionalDown && short.netPips < 0;

  let candidate: MovementState = "NORMAL";
  if (rapidShortUp) candidate = "RAPID_UP";
  else if (rapidShortDown) candidate = "RAPID_DOWN";
  else if (short.upCount >= TREND_DIRECTION_COUNT
    && short.netPips + PIP_COMPARISON_EPSILON >= thresholds.trend) candidate = "UP_TREND";
  else if (short.downCount >= TREND_DIRECTION_COUNT
    && short.netPips - PIP_COMPARISON_EPSILON <= -thresholds.trend) candidate = "DOWN_TREND";
  const magnitudeRatio = netMagnitude / Math.max(
    thresholds.rapidShort,
    thresholds.percentile95FiveMove,
    thresholds.absoluteMove90 * RAPID_SHORT_WINDOW,
    thresholds.rangeMinimum,
    PIP_COMPARISON_EPSILON,
  );
  const rapidIntensity = Math.sqrt(magnitudeRatio * (accelerationRatio / RAPID_ACCELERATION_MULTIPLIER));
  const shortPoints = history.slice(-(RAPID_SHORT_WINDOW + 1));
  return {
    candidate,
    short,
    long,
    thresholds,
    directionEfficiency,
    accelerationRatio,
    startPrice: shortPoints[0].price,
    latestPrice: shortPoints.at(-1)!.price,
    ratioToMedian,
    percentile5,
    rangeRatio,
    rapidIntensity,
  };
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
