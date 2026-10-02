export const SYNTHETIC_SYMBOLS = ["EUR/USD", "GBP/USD", "EUR/GBP"] as const;
export type SyntheticSymbol = typeof SYNTHETIC_SYMBOLS[number];
export type SyntheticStatus = "RAW" | "LEARNING" | "CORRECTED";

export const SYNTHETIC_CONFIG = {
  maxSamples: 100,
  provisionalSamples: 20,
  correctedSamples: 50,
  normalSamples: 100,
  maxTimestampDifferenceMs: 20_000,
  staleAfterMs: 120_000,
  maximumCorrectionStepPips: 2,
  minimumJumpLimitPips: 5,
  maximumJumpLimitPips: 25,
  jumpVolatilityMultiplier: 8,
} as const;

export type TimedPrice = { price: number; timestamp: number };
export type SyntheticPoint = {
  symbol: SyntheticSymbol;
  timestamp: number;
  rawSynthetic: number;
  correctedSynthetic: number;
  appliedCorrection: number;
  sourceTimestamps: number[];
};
export type ErrorSample = {
  timestamp: number;
  error: number;
  rawErrorPips: number;
  correctedErrorPips: number;
};
export type SyntheticStats = {
  sampleCount: number;
  medianError: number;
  meanError: number;
  rawMaePips: number;
  correctedMaePips: number;
  rawMedianAbsoluteErrorPips: number;
  correctedMedianAbsoluteErrorPips: number;
  rawP95Pips: number;
  correctedP95Pips: number;
  maxAbsoluteErrorPips: number;
};
export type SyntheticLearningState = {
  errors: ErrorSample[];
  activeMedianError: number;
  lastYahooTimestamp: number | null;
  status: SyntheticStatus;
  useCorrected: boolean;
  stats: SyntheticStats;
};

const EMPTY_STATS: SyntheticStats = {
  sampleCount: 0,
  medianError: 0,
  meanError: 0,
  rawMaePips: 0,
  correctedMaePips: 0,
  rawMedianAbsoluteErrorPips: 0,
  correctedMedianAbsoluteErrorPips: 0,
  rawP95Pips: 0,
  correctedP95Pips: 0,
  maxAbsoluteErrorPips: 0,
};

export function emptySyntheticLearningState(): SyntheticLearningState {
  return {
    errors: [],
    activeMedianError: 0,
    lastYahooTimestamp: null,
    status: "RAW",
    useCorrected: false,
    stats: { ...EMPTY_STATS },
  };
}

function median(values: number[]) {
  if (!values.length) return 0;
  const ordered = [...values].sort((left, right) => left - right);
  const middle = Math.floor(ordered.length / 2);
  return ordered.length % 2 ? ordered[middle] : (ordered[middle - 1] + ordered[middle]) / 2;
}

function percentile(values: number[], percentileValue: number) {
  if (!values.length) return 0;
  const ordered = [...values].sort((left, right) => left - right);
  const index = Math.ceil((percentileValue / 100) * ordered.length) - 1;
  return ordered[Math.max(0, Math.min(ordered.length - 1, index))];
}

export function calculateSyntheticStats(errors: ErrorSample[]): SyntheticStats {
  if (!errors.length) return { ...EMPTY_STATS };
  const raw = errors.map((sample) => Math.abs(sample.rawErrorPips));
  const corrected = errors.map((sample) => Math.abs(sample.correctedErrorPips));
  return {
    sampleCount: errors.length,
    medianError: median(errors.map((sample) => sample.error)),
    meanError: errors.reduce((sum, sample) => sum + sample.error, 0) / errors.length,
    rawMaePips: raw.reduce((sum, value) => sum + value, 0) / raw.length,
    correctedMaePips: corrected.reduce((sum, value) => sum + value, 0) / corrected.length,
    rawMedianAbsoluteErrorPips: median(raw),
    correctedMedianAbsoluteErrorPips: median(corrected),
    rawP95Pips: percentile(raw, 95),
    correctedP95Pips: percentile(corrected, 95),
    maxAbsoluteErrorPips: Math.max(...raw),
  };
}

export function rawSyntheticFor(symbol: SyntheticSymbol, sources: Record<string, TimedPrice>, nowMs: number): SyntheticPoint | null {
  const sourceCodes = symbol === "EUR/USD"
    ? ["EUR/JPY", "USD/JPY"]
    : symbol === "GBP/USD"
      ? ["GBP/JPY", "USD/JPY"]
      : ["EUR/JPY", "GBP/JPY"];
  const [left, right] = sourceCodes.map((code) => sources[code]);
  if (!left || !right || !Number.isFinite(left.price) || !Number.isFinite(right.price) || right.price === 0) return null;
  const timestamps = [left.timestamp * 1000, right.timestamp * 1000];
  if (Math.abs(timestamps[0] - timestamps[1]) > SYNTHETIC_CONFIG.maxTimestampDifferenceMs) return null;
  if (timestamps.some((timestamp) => nowMs - timestamp > SYNTHETIC_CONFIG.staleAfterMs || timestamp - nowMs > SYNTHETIC_CONFIG.maxTimestampDifferenceMs)) return null;
  const rawSynthetic = left.price / right.price;
  if (!Number.isFinite(rawSynthetic) || rawSynthetic <= 0) return null;
  return {
    symbol,
    timestamp: Math.floor(Math.max(...timestamps) / 1000),
    rawSynthetic,
    correctedSynthetic: rawSynthetic,
    appliedCorrection: 0,
    sourceTimestamps: timestamps.map((value) => Math.floor(value / 1000)),
  };
}

export function correctionFor(state: SyntheticLearningState) {
  return state.useCorrected && state.errors.length >= SYNTHETIC_CONFIG.correctedSamples
    ? state.activeMedianError
    : 0;
}

export function applyCurrentCorrection(point: SyntheticPoint, state: SyntheticLearningState): SyntheticPoint {
  const correction = state.lastYahooTimestamp !== null && point.timestamp <= state.lastYahooTimestamp
    ? 0
    : correctionFor(state);
  return { ...point, appliedCorrection: correction, correctedSynthetic: point.rawSynthetic + correction };
}

export function learnFromYahoo(
  state: SyntheticLearningState,
  yahoo: TimedPrice,
  rawHistory: SyntheticPoint[],
): { state: SyntheticLearningState; accepted: boolean; warning?: string; sample?: ErrorSample } {
  if (state.lastYahooTimestamp !== null && yahoo.timestamp <= state.lastYahooTimestamp) return { state, accepted: false };
  const yahooMs = yahoo.timestamp * 1000;
  const nearest = [...rawHistory]
    .map((point) => ({ point, distance: Math.abs(point.timestamp * 1000 - yahooMs) }))
    .sort((left, right) => left.distance - right.distance)[0];
  const sourceAligned = nearest?.point.sourceTimestamps.every((timestamp) => Math.abs(timestamp * 1000 - yahooMs) <= SYNTHETIC_CONFIG.maxTimestampDifferenceMs);
  if (!nearest || nearest.distance > SYNTHETIC_CONFIG.maxTimestampDifferenceMs || !sourceAligned) {
    return { state: { ...state, lastYahooTimestamp: yahoo.timestamp }, accepted: false };
  }
  const pipSize = 0.0001;
  const correctionBeforeLearning = correctionFor(state);
  const error = yahoo.price - nearest.point.rawSynthetic;
  const sample: ErrorSample = {
    timestamp: yahoo.timestamp,
    error,
    rawErrorPips: error / pipSize,
    correctedErrorPips: (yahoo.price - (nearest.point.rawSynthetic + correctionBeforeLearning)) / pipSize,
  };
  const errors = [...state.errors, sample].slice(-SYNTHETIC_CONFIG.maxSamples);
  const stats = calculateSyntheticStats(errors);
  let activeMedianError = state.activeMedianError;
  let warning: string | undefined;
  if (errors.length >= SYNTHETIC_CONFIG.provisionalSamples) {
    const candidate = stats.medianError;
    const changePips = Math.abs(candidate - state.activeMedianError) / pipSize;
    if (state.activeMedianError !== 0 && changePips > SYNTHETIC_CONFIG.maximumCorrectionStepPips) {
      warning = `median correction jump blocked: ${changePips.toFixed(2)} pips`;
    } else {
      activeMedianError = candidate;
    }
  }
  const enough = errors.length >= SYNTHETIC_CONFIG.correctedSamples;
  const qualityImproved = stats.correctedMaePips <= stats.rawMaePips && stats.correctedP95Pips <= stats.rawP95Pips;
  const useCorrected = enough && qualityImproved;
  const status: SyntheticStatus = errors.length < SYNTHETIC_CONFIG.provisionalSamples
    ? "RAW"
    : useCorrected ? "CORRECTED" : "LEARNING";
  return {
    accepted: true,
    sample,
    warning,
    state: {
      errors,
      activeMedianError,
      lastYahooTimestamp: yahoo.timestamp,
      status,
      useCorrected,
      stats: { ...stats, medianError: activeMedianError },
    },
  };
}

export function isSyntheticJumpValid(history: TimedPrice[], nextPrice: number) {
  const previous = history.at(-1)?.price;
  if (previous === undefined) return true;
  const moves = history.slice(-25).slice(1).map((point, index) => Math.abs(point.price - history.slice(-25)[index].price) / 0.0001);
  const recentMedian = median(moves);
  const limit = Math.min(
    SYNTHETIC_CONFIG.maximumJumpLimitPips,
    Math.max(SYNTHETIC_CONFIG.minimumJumpLimitPips, recentMedian * SYNTHETIC_CONFIG.jumpVolatilityMultiplier),
  );
  return Math.abs(nextPrice - previous) / 0.0001 <= limit;
}
