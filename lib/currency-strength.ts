export const CURRENCY_STRENGTH_WINDOWS = [60, 30, 15, 7] as const;
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

const CURRENCY_STRENGTH_LOG_SCALE = 0.0002;

export function pairPeriodSignal(history: StrengthPoint[], windowSize: number) {
  const points = history.slice(-windowSize);
  if (points.length < windowSize) return null;
  const logs = points.map((point) => Math.log(point.price));
  const count = logs.length;
  const endpoint = (logs[count - 1] - logs[0]) / (count - 1);
  const meanX = (count - 1) / 2;
  const meanY = logs.reduce((sum, value) => sum + value, 0) / count;
  let covariance = 0;
  let variance = 0;
  for (let index = 0; index < count; index += 1) {
    covariance += (index - meanX) * (logs[index] - meanY);
    variance += (index - meanX) ** 2;
  }
  const slope = variance ? covariance / variance : 0;
  const returns = logs.slice(1).map((value, index) => value - logs[index]);
  const meanAbsolute = returns.reduce((sum, value) => sum + Math.abs(value), 0) / returns.length;
  const directionBalance = returns.reduce((sum, value) => sum + Math.sign(value), 0) / returns.length;
  const consistency = directionBalance * meanAbsolute;
  return endpoint * 0.45 + slope * 0.4 + consistency * 0.15;
}

export function calculateCurrencyStrength(histories: Record<string, StrengthPoint[]>, windowSize: number) {
  const raw = Object.fromEntries(STRENGTH_CURRENCIES.map((currency) => [currency, 0])) as CurrencyStrength;
  const counts = Object.fromEntries(STRENGTH_CURRENCIES.map((currency) => [currency, 0])) as CurrencyStrength;
  const pairSignals: Record<string, number> = {};
  let usedPairs = 0;

  for (const pairCode of STRENGTH_PAIR_CODES) {
    const signal = pairPeriodSignal(histories[pairCode] ?? [], windowSize);
    if (signal === null) continue;
    const [base, quote] = pairCode.split("/") as [CurrencyCode, CurrencyCode];
    pairSignals[pairCode] = signal;
    raw[base] += signal;
    raw[quote] -= signal;
    counts[base] += 1;
    counts[quote] += 1;
    usedPairs += 1;
  }

  if (usedPairs < STRENGTH_PAIR_CODES.length) {
    return { ready: false, scores: null, raw, pairSignals, pairScores: {}, usedPairs };
  }

  const scores = Object.fromEntries(STRENGTH_CURRENCIES.map((currency) => {
    const average = counts[currency] ? raw[currency] / counts[currency] : 0;
    return [currency, Math.max(0, Math.min(100, 50 + (average / CURRENCY_STRENGTH_LOG_SCALE) * 50))];
  })) as CurrencyStrength;
  const pairScores = Object.fromEntries(STRENGTH_PAIR_CODES.map((pairCode) => {
    const [base, quote] = pairCode.split("/") as [CurrencyCode, CurrencyCode];
    return [pairCode, scores[base] - scores[quote]];
  }));

  return { ready: true, scores, raw, pairSignals, pairScores, usedPairs };
}
