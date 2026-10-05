export const dynamic = "force-dynamic";
export const runtime = "edge";

const SYMBOLS = {
  "USD/JPY": "USDJPY=X",
  "EUR/USD": "EURUSD=X",
  "GBP/USD": "GBPUSD=X",
  "AUD/USD": "AUDUSD=X",
  "EUR/JPY": "EURJPY=X",
  "GBP/JPY": "GBPJPY=X",
  "AUD/JPY": "AUDJPY=X",
  "EUR/GBP": "EURGBP=X",
  "EUR/AUD": "EURAUD=X",
  "GBP/AUD": "GBPAUD=X",
} as const;

type Pair = keyof typeof SYMBOLS;
type Rate = { price: number; timestamp: number };
type YahooChart = {
  meta?: { regularMarketPrice?: number; regularMarketTime?: number };
  timestamp?: Array<number | null>;
  indicators?: { quote?: Array<{ close?: Array<number | null> }> };
};

const yahooHeaders = {
  Accept: "application/json",
  "User-Agent": "Mozilla/5.0 (compatible; FX-Rate-Speaker/1.0)",
};

function validRate(price: unknown, timestamp: unknown): Rate | null {
  if (!Number.isFinite(price) || !Number.isFinite(timestamp)) return null;
  return { price: Number(price), timestamp: Number(timestamp) };
}

function latestChartRate(chart: YahooChart | undefined): Rate | null {
  const live = validRate(chart?.meta?.regularMarketPrice, chart?.meta?.regularMarketTime);
  if (live) return live;
  const timestamps = chart?.timestamp ?? [];
  const closes = chart?.indicators?.quote?.[0]?.close ?? [];
  for (let index = Math.min(timestamps.length, closes.length) - 1; index >= 0; index -= 1) {
    const rate = validRate(closes[index], timestamps[index]);
    if (rate) return rate;
  }
  return null;
}

function chartCloses(chart: YahooChart | undefined): Map<number, number> {
  const out = new Map<number, number>();
  const timestamps = chart?.timestamp ?? [];
  const closes = chart?.indicators?.quote?.[0]?.close ?? [];
  for (let index = 0; index < Math.min(timestamps.length, closes.length); index += 1) {
    const timestamp = timestamps[index];
    const close = closes[index];
    if (Number.isFinite(timestamp) && Number.isFinite(close)) {
      out.set(Number(timestamp), Number(close));
    }
  }
  return out;
}

async function fetchYahooChart(pair: Pair): Promise<YahooChart | null> {
  const symbol = SYMBOLS[pair];
  for (const host of ["query2.finance.yahoo.com", "query1.finance.yahoo.com"]) {
    const url = `https://${host}/v8/finance/chart/${encodeURIComponent(symbol)}?interval=1m&range=1d&_=${Date.now()}`;
    const response = await fetch(url, { cache: "no-store", headers: yahooHeaders });
    if (!response.ok) continue;
    const data = await response.json() as { chart?: { result?: YahooChart[] } };
    const chart = data.chart?.result?.[0];
    if (chart) return chart;
  }
  return null;
}

function pipSize(pair: Pair) {
  return pair.endsWith("/JPY") ? 0.01 : 0.0001;
}

function formula(pair: Pair): { left: Pair; right: Pair; operation: "multiply" | "divide" } | null {
  if (pair === "EUR/JPY") return { left: "EUR/USD", right: "USD/JPY", operation: "multiply" };
  if (pair === "GBP/JPY") return { left: "GBP/USD", right: "USD/JPY", operation: "multiply" };
  if (pair === "AUD/JPY") return { left: "AUD/USD", right: "USD/JPY", operation: "multiply" };
  if (pair === "EUR/GBP") return { left: "EUR/USD", right: "GBP/USD", operation: "divide" };
  if (pair === "EUR/AUD") return { left: "EUR/USD", right: "AUD/USD", operation: "divide" };
  if (pair === "GBP/AUD") return { left: "GBP/USD", right: "AUD/USD", operation: "divide" };
  return null;
}

function syntheticFromRates(pair: Pair, direct: Partial<Record<Pair, Rate>>) {
  const spec = formula(pair);
  if (!spec) return null;
  const left = direct[spec.left];
  const right = direct[spec.right];
  if (!left || !right) return null;
  const price = spec.operation === "multiply" ? left.price * right.price : left.price / right.price;
  return {
    price,
    timestamp: Math.min(left.timestamp, right.timestamp),
    sourceTimestampSpreadSec: Math.abs(left.timestamp - right.timestamp),
  };
}

function latestCommonTimestamp(maps: Array<Map<number, number>>): number | null {
  if (maps.length === 0) return null;
  const candidates = [...maps[0].keys()].sort((a, b) => b - a);
  for (const timestamp of candidates) {
    if (maps.every((map) => map.has(timestamp))) return timestamp;
  }
  return null;
}

export async function GET() {
  const pairs = Object.keys(SYMBOLS) as Pair[];
  const chartEntries = await Promise.all(pairs.map(async (pair) => {
    try {
      return [pair, await fetchYahooChart(pair)] as const;
    } catch {
      return [pair, null] as const;
    }
  }));

  const charts: Partial<Record<Pair, YahooChart>> = {};
  const direct: Partial<Record<Pair, Rate>> = {};
  const closes: Partial<Record<Pair, Map<number, number>>> = {};

  for (const [pair, chart] of chartEntries) {
    if (!chart) continue;
    charts[pair] = chart;
    closes[pair] = chartCloses(chart);
    const latest = latestChartRate(chart);
    if (latest) direct[pair] = latest;
  }

  const comparePairs: Pair[] = ["EUR/JPY", "GBP/JPY", "AUD/JPY", "EUR/GBP", "EUR/AUD", "GBP/AUD"];

  const comparisons = comparePairs.map((pair) => {
    const actual = direct[pair];
    const calc = syntheticFromRates(pair, direct);
    if (!actual || !calc) return { pair, available: false };
    const deltaPips = (actual.price - calc.price) / pipSize(pair);
    return {
      pair,
      available: true,
      directPrice: actual.price,
      syntheticPrice: calc.price,
      deltaPips,
      absDeltaPips: Math.abs(deltaPips),
      directTimestamp: actual.timestamp,
      syntheticTimestamp: calc.timestamp,
      directVsSyntheticTimestampSkewSec: actual.timestamp - calc.timestamp,
      sourceTimestampSpreadSec: calc.sourceTimestampSpreadSec,
    };
  });

  const syncedComparisons = comparePairs.map((pair) => {
    const spec = formula(pair);
    if (!spec) return { pair, available: false };
    const pairMap = closes[pair];
    const leftMap = closes[spec.left];
    const rightMap = closes[spec.right];
    if (!pairMap || !leftMap || !rightMap) return { pair, available: false };
    const timestamp = latestCommonTimestamp([pairMap, leftMap, rightMap]);
    if (timestamp === null) return { pair, available: false };
    const directPrice = pairMap.get(timestamp);
    const leftPrice = leftMap.get(timestamp);
    const rightPrice = rightMap.get(timestamp);
    if (!Number.isFinite(directPrice) || !Number.isFinite(leftPrice) || !Number.isFinite(rightPrice)) {
      return { pair, available: false };
    }
    const syntheticPrice = spec.operation === "multiply"
      ? Number(leftPrice) * Number(rightPrice)
      : Number(leftPrice) / Number(rightPrice);
    const deltaPips = (Number(directPrice) - syntheticPrice) / pipSize(pair);
    return {
      pair,
      available: true,
      timestamp,
      directPrice: Number(directPrice),
      syntheticPrice,
      deltaPips,
      absDeltaPips: Math.abs(deltaPips),
      leftBasePair: spec.left,
      leftBasePrice: Number(leftPrice),
      rightBasePair: spec.right,
      rightBasePrice: Number(rightPrice),
    };
  });

  const rank = (items: Array<Record<string, unknown>>) => [...items]
    .filter((item) => item.available === true && typeof item.absDeltaPips === "number")
    .sort((a, b) => Number(b.absDeltaPips) - Number(a.absDeltaPips));

  return Response.json({
    purpose: "Yahoo direct-vs-4-base synthetic consistency shadow audit",
    basePairs: ["USD/JPY", "EUR/USD", "GBP/USD", "AUD/USD"],
    direct,
    comparisons,
    rankedByAbsDeltaPips: rank(comparisons),
    syncedComparisons,
    syncedRankedByAbsDeltaPips: rank(syncedComparisons),
    syncedMeaning: "Direct cross and both base-pair 1m closes are compared at the exact same Yahoo timestamp.",
    fetchedAt: Math.floor(Date.now() / 1000),
  }, {
    headers: {
      "Cache-Control": "no-store, no-cache, max-age=0, must-revalidate",
      "CDN-Cache-Control": "no-store",
    },
  });
}
