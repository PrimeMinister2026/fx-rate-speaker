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

const headers = {
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

async function fetchYahoo(pair: Pair): Promise<Rate | null> {
  const symbol = SYMBOLS[pair];
  for (const host of ["query2.finance.yahoo.com", "query1.finance.yahoo.com"]) {
    const url = `https://${host}/v8/finance/chart/${encodeURIComponent(symbol)}?interval=1m&range=1d&_=${Date.now()}`;
    const response = await fetch(url, { cache: "no-store", headers });
    if (!response.ok) continue;
    const data = await response.json() as { chart?: { result?: YahooChart[] } };
    const rate = latestChartRate(data.chart?.result?.[0]);
    if (rate) return rate;
  }
  return null;
}

function pipSize(pair: Pair) {
  return pair.endsWith("/JPY") ? 0.01 : 0.0001;
}

function synthetic(
  pair: Pair,
  direct: Partial<Record<Pair, Rate>>,
): { price: number; timestamp: number; sourceTimestampSpreadSec: number } | null {
  const usdJpy = direct["USD/JPY"];
  const eurUsd = direct["EUR/USD"];
  const gbpUsd = direct["GBP/USD"];
  const audUsd = direct["AUD/USD"];

  let sources: Rate[] | null = null;
  let price: number | null = null;

  if (pair === "EUR/JPY" && eurUsd && usdJpy) {
    sources = [eurUsd, usdJpy];
    price = eurUsd.price * usdJpy.price;
  } else if (pair === "GBP/JPY" && gbpUsd && usdJpy) {
    sources = [gbpUsd, usdJpy];
    price = gbpUsd.price * usdJpy.price;
  } else if (pair === "AUD/JPY" && audUsd && usdJpy) {
    sources = [audUsd, usdJpy];
    price = audUsd.price * usdJpy.price;
  } else if (pair === "EUR/GBP" && eurUsd && gbpUsd) {
    sources = [eurUsd, gbpUsd];
    price = eurUsd.price / gbpUsd.price;
  } else if (pair === "EUR/AUD" && eurUsd && audUsd) {
    sources = [eurUsd, audUsd];
    price = eurUsd.price / audUsd.price;
  } else if (pair === "GBP/AUD" && gbpUsd && audUsd) {
    sources = [gbpUsd, audUsd];
    price = gbpUsd.price / audUsd.price;
  }

  if (!sources || price === null) return null;
  const timestamps = sources.map((source) => source.timestamp);
  return {
    price,
    timestamp: Math.min(...timestamps),
    sourceTimestampSpreadSec: Math.max(...timestamps) - Math.min(...timestamps),
  };
}

export async function GET() {
  const pairs = Object.keys(SYMBOLS) as Pair[];
  const entries = await Promise.all(pairs.map(async (pair) => {
    try {
      return [pair, await fetchYahoo(pair)] as const;
    } catch {
      return [pair, null] as const;
    }
  }));

  const direct: Partial<Record<Pair, Rate>> = {};
  for (const [pair, rate] of entries) if (rate) direct[pair] = rate;

  const comparePairs: Pair[] = ["EUR/JPY", "GBP/JPY", "AUD/JPY", "EUR/GBP", "EUR/AUD", "GBP/AUD"];
  const comparisons = comparePairs.map((pair) => {
    const actual = direct[pair];
    const calc = synthetic(pair, direct);
    if (!actual || !calc) {
      return { pair, available: false };
    }
    const delta = actual.price - calc.price;
    const deltaPips = delta / pipSize(pair);
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

  const ranked = comparisons
    .filter((item) => item.available && "absDeltaPips" in item)
    .sort((a, b) => {
      const left = "absDeltaPips" in a ? Number(a.absDeltaPips) : -1;
      const right = "absDeltaPips" in b ? Number(b.absDeltaPips) : -1;
      return right - left;
    });

  return Response.json({
    purpose: "Yahoo direct-vs-4-base synthetic consistency shadow audit",
    basePairs: ["USD/JPY", "EUR/USD", "GBP/USD", "AUD/USD"],
    direct,
    comparisons,
    rankedByAbsDeltaPips: ranked,
    fetchedAt: Math.floor(Date.now() / 1000),
  }, {
    headers: {
      "Cache-Control": "no-store, no-cache, max-age=0, must-revalidate",
      "CDN-Cache-Control": "no-store",
    },
  });
}
