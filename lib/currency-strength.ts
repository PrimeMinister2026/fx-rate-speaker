export const CURRENCY_STRENGTH_WINDOWS = [60, 15, 5, 1] as const;
export type CurrencyStrengthWindowMinutes = typeof CURRENCY_STRENGTH_WINDOWS[number];
export const STRENGTH_CURRENCIES = ["USD", "JPY", "EUR", "GBP", "AUD"] as const;
export const STRENGTH_VERTEX_ORDER = ["USD", "JPY", "AUD", "GBP", "EUR"] as const;
export const STRENGTH_PAIR_CODES = [
  "USD/JPY",
  "EUR/USD",
  "GBP/USD",
  "AUD/USD",
  "EUR/JPY",
  "GBP/JPY",
  "AUD/JPY",
  "EUR/GBP",
  "EUR/AUD",
  "GBP/AUD",
] as const;

export type CurrencyCode = typeof STRENGTH_CURRENCIES[number];
export type CurrencyStrength = Record<CurrencyCode, number>;
export type StrengthPoint = { price: number; timestamp: number };

type PairFeature = {
  totalReturn: number;
  direction: number;
  quality: number;
  continuation: number;
  acceleration: number;
  magnitude: number;
  magnitudeRank: number;
};


const EPSILON = 1e-12;
export const STRENGTH_TARGET_TOLERANCE_SECONDS = 75;

function clamp(value: number, min: number, max: number) {
  return Math.max(min, Math.min(max, value));
}

function mean(values: number[]) {
  if (!values.length) return 0;
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

function windowWeights(windowMinutes: number) {
  if (windowMinutes >= 60) {
    return { rank: 0.40, agreement: 0.30, continuation: 0.25, magnitude: 0.05, acceleration: 0 };
  }
  if (windowMinutes >= 15) {
    return { rank: 0.30, agreement: 0.30, continuation: 0.25, magnitude: 0.10, acceleration: 0.05 };
  }
  return { rank: 0.25, agreement: 0.30, continuation: 0.25, magnitude: 0.15, acceleration: 0.05 };
}

function scoreSpan(windowMinutes: number) {
  if (windowMinutes >= 60) return 48;
  if (windowMinutes >= 15) return 40;
  if (windowMinutes >= 5) return 36;
  return 32;
}

function sortedValidPoints(history: StrengthPoint[]) {
  const byTimestamp = new Map<number, StrengthPoint>();
  history.forEach((point) => {
    if (Number.isFinite(point.price) && point.price > 0 && Number.isFinite(point.timestamp)) {
      byTimestamp.set(point.timestamp, point);
    }
  });
  return [...byTimestamp.values()].sort((left, right) => left.timestamp - right.timestamp);
}

export function periodPoints(history: StrengthPoint[], windowMinutes: number) {
  const valid = sortedValidPoints(history);
  if (valid.length < 2) return null;
  const latest = valid.at(-1)!;
  const targetTimestamp = latest.timestamp - windowMinutes * 60;
  let start = valid[0];
  let closestDistance = Math.abs(start.timestamp - targetTimestamp);
  for (const point of valid) {
    const distance = Math.abs(point.timestamp - targetTimestamp);
    if (distance < closestDistance) {
      start = point;
      closestDistance = distance;
    }
  }
  if (closestDistance > STRENGTH_TARGET_TOLERANCE_SECONDS) return null;
  const points = valid.filter((point) => point.timestamp >= start.timestamp && point.timestamp <= latest.timestamp);
  return points.length >= 2 ? { points, targetTimestamp, startTimestamp: start.timestamp, endTimestamp: latest.timestamp } : null;
}

export function pairPeriodSignal(history: StrengthPoint[], windowMinutes: number) {
  const period = periodPoints(history, windowMinutes);
  if (!period) return null;
  const { points } = period;

  const logs = points.map((point) => Math.log(point.price));
  const returns = logs.slice(1).map((value, index) => value - logs[index]);
  const totalReturn = logs.at(-1)! - logs[0];
  const direction = Math.sign(totalReturn);
  const meanAbsoluteReturn = mean(returns.map((value) => Math.abs(value)));
  const pathLength = returns.reduce((sum, value) => sum + Math.abs(value), 0);
  const efficiency = pathLength > EPSILON ? Math.abs(totalReturn) / pathLength : 0;
  const signedMoves = returns.map((value) => Math.sign(value)).filter((value) => value !== 0);
  const directionBalance = signedMoves.length
    ? signedMoves.reduce((sum, value) => sum + value, 0) / signedMoves.length
    : 0;
  const activityConfidence = clamp(
    signedMoves.length / Math.max(3, Math.ceil(returns.length * 0.15)),
    0,
    1,
  );
  const quality = clamp(
    (efficiency * 0.45 + Math.abs(directionBalance) * 0.35 + activityConfidence * 0.20)
      * (0.65 + activityConfidence * 0.35),
    0,
    1,
  );

  const split = Math.max(1, Math.floor(returns.length * 0.6));
  const earlier = returns.slice(0, split);
  const later = returns.slice(split);
  const acceleration = later.length && meanAbsoluteReturn > EPSILON
    ? clamp((mean(later) - mean(earlier)) / (meanAbsoluteReturn * 2), -1, 1)
    : 0;

  return {
    totalReturn,
    direction,
    quality,
    continuation: directionBalance,
    acceleration,
    magnitude: Math.abs(totalReturn),
    magnitudeRank: 0,
  } satisfies PairFeature;
}

function attachMagnitudeRanks(features: Record<string, PairFeature>) {
  const entries = Object.entries(features);
  const maximumMagnitude = Math.max(EPSILON, ...entries.map(([, feature]) => feature.magnitude));
  const sorted = [...entries].sort((left, right) => left[1].magnitude - right[1].magnitude);

  sorted.forEach(([pairCode, feature], index) => {
    const rank = sorted.length <= 1 ? 1 : index / (sorted.length - 1);
    features[pairCode] = {
      ...feature,
      magnitude: feature.magnitude / maximumMagnitude,
      magnitudeRank: rank,
    };
  });
}

export function calculateCurrencyStrength(histories: Record<string, StrengthPoint[]>, windowMinutes: number) {
  const raw = Object.fromEntries(STRENGTH_CURRENCIES.map((currency) => [currency, 0])) as CurrencyStrength;
  const counts = Object.fromEntries(STRENGTH_CURRENCIES.map((currency) => [currency, 0])) as CurrencyStrength;
  const pairSignals: Record<string, number> = {};
  const features: Record<string, PairFeature> = {};
  const periods: Record<string, { usedPointCount: number; startTimestamp: number; endTimestamp: number }> = {};
  let usedPairs = 0;

  for (const pairCode of STRENGTH_PAIR_CODES) {
    const period = periodPoints(histories[pairCode] ?? [], windowMinutes);
    const feature = pairPeriodSignal(histories[pairCode] ?? [], windowMinutes);
    if (feature === null) continue;
    features[pairCode] = feature;
    periods[pairCode] = {
      usedPointCount: period!.points.length,
      startTimestamp: period!.startTimestamp,
      endTimestamp: period!.endTimestamp,
    };
    pairSignals[pairCode] = feature.totalReturn;
    usedPairs += 1;
  }

  if (usedPairs < STRENGTH_PAIR_CODES.length) {
    return { ready: false, scores: null, raw, pairSignals, pairScores: {}, usedPairs, periods };
  }

  attachMagnitudeRanks(features);
  const weights = windowWeights(windowMinutes);
  const componentTotals = Object.fromEntries(STRENGTH_CURRENCIES.map((currency) => [currency, {
    rank: 0,
    agreement: 0,
    continuation: 0,
    magnitude: 0,
    acceleration: 0,
  }])) as Record<CurrencyCode, {
    rank: number;
    agreement: number;
    continuation: number;
    magnitude: number;
    acceleration: number;
  }>;

  for (const pairCode of STRENGTH_PAIR_CODES) {
    const [base, quote] = pairCode.split("/") as [CurrencyCode, CurrencyCode];
    const feature = features[pairCode];
    const signedQuality = feature.direction * feature.quality;
    const signedRank = feature.direction * feature.magnitudeRank * feature.quality;
    const signedMagnitude = feature.direction * feature.magnitude * feature.quality;

    componentTotals[base].rank += signedRank;
    componentTotals[quote].rank -= signedRank;
    componentTotals[base].agreement += signedQuality;
    componentTotals[quote].agreement -= signedQuality;
    componentTotals[base].continuation += feature.continuation;
    componentTotals[quote].continuation -= feature.continuation;
    componentTotals[base].magnitude += signedMagnitude;
    componentTotals[quote].magnitude -= signedMagnitude;
    componentTotals[base].acceleration += feature.acceleration;
    componentTotals[quote].acceleration -= feature.acceleration;
    counts[base] += 1;
    counts[quote] += 1;
  }

  const scores = Object.fromEntries(STRENGTH_CURRENCIES.map((currency) => {
    const divisor = counts[currency] || 1;
    const components = componentTotals[currency];
    const composite =
      (components.rank / divisor) * weights.rank
      + (components.agreement / divisor) * weights.agreement
      + (components.continuation / divisor) * weights.continuation
      + (components.magnitude / divisor) * weights.magnitude
      + (components.acceleration / divisor) * weights.acceleration;

    raw[currency] = composite;
    return [currency, clamp(50 + composite * scoreSpan(windowMinutes), 0, 100)];
  })) as CurrencyStrength;

  const pairScores = Object.fromEntries(STRENGTH_PAIR_CODES.map((pairCode) => {
    const [base, quote] = pairCode.split("/") as [CurrencyCode, CurrencyCode];
    return [pairCode, scores[base] - scores[quote]];
  }));

  return { ready: true, scores, raw, pairSignals, pairScores, usedPairs, periods };
}
