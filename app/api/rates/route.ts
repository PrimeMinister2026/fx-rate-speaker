import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";

const YAHOO_SYMBOLS = {
  "USD/JPY": "USDJPY=X",
  "EUR/JPY": "EURJPY=X",
  "GBP/JPY": "GBPJPY=X",
  "AUD/JPY": "AUDJPY=X",
} as const;

const SYNTHETIC_SOURCE_SYMBOLS = {
  "USD/JPY": "USDJPY=X",
  "EUR/JPY": "EURJPY=X",
  "GBP/JPY": "GBPJPY=X",
} as const;

const SYNTHETIC_ACTUAL_SYMBOLS = {
  "EUR/USD": "EURUSD=X",
  "GBP/USD": "GBPUSD=X",
  "EUR/GBP": "EURGBP=X",
} as const;

type DirectCode = keyof typeof YAHOO_SYMBOLS;
type SyntheticSourceCode = keyof typeof SYNTHETIC_SOURCE_SYMBOLS;
type SyntheticActualCode = keyof typeof SYNTHETIC_ACTUAL_SYMBOLS;
type DirectRate = { price: number; timestamp: number };

type YahooChart = {
  meta?: { regularMarketPrice?: number; regularMarketTime?: number };
  timestamp?: Array<number | null>;
  indicators?: { quote?: Array<{ close?: Array<number | null> }> };
};

const yahooHeaders = {
  Accept: "application/json",
  "User-Agent": "Mozilla/5.0 (compatible; FX-Rate-Speaker/1.0)",
};

function validRate(price: unknown, timestamp: unknown): DirectRate | null {
  if (!Number.isFinite(price) || !Number.isFinite(timestamp)) return null;
  return { price: Number(price), timestamp: Number(timestamp) };
}

function latestChartRate(chart: YahooChart | undefined): DirectRate | null {
  // Yahoo's meta quote can move between completed one-minute candles. Prefer it for the
  // 10-second live snapshot; keep the latest 1m close as the fallback/reference source.
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

async function fetchYahooRate(code: DirectCode): Promise<DirectRate | null> {
  const symbol = YAHOO_SYMBOLS[code];
  for (const host of ["query2.finance.yahoo.com", "query1.finance.yahoo.com"]) {
    const url = `https://${host}/v8/finance/chart/${encodeURIComponent(symbol)}?interval=1m&range=1d&_=${Date.now()}`;
    const response = await fetch(url, { cache: "no-store", headers: yahooHeaders });
    if (!response.ok) continue;
    const data = await response.json() as {
      chart?: { result?: YahooChart[] };
    };
    const rate = latestChartRate(data.chart?.result?.[0]);
    if (rate) return rate;
  }
  return null;
}

async function fetchSyntheticActual(code: SyntheticActualCode): Promise<DirectRate | null> {
  const symbol = SYNTHETIC_ACTUAL_SYMBOLS[code];
  for (const host of ["query2.finance.yahoo.com", "query1.finance.yahoo.com"]) {
    const url = `https://${host}/v8/finance/chart/${encodeURIComponent(symbol)}?interval=1m&range=1d&_=${Date.now()}`;
    const response = await fetch(url, { cache: "no-store", headers: yahooHeaders });
    if (!response.ok) continue;
    const data = await response.json() as { chart?: { result?: YahooChart[] } };
    const rate = latestChartRate(data.chart?.result?.[0]);
    if (rate) return rate;
  }
  return null;
}

export async function GET() {
  const [baseEntries, syntheticActualEntries] = await Promise.all([
    Promise.all((Object.keys(YAHOO_SYMBOLS) as DirectCode[]).map(async (code) => {
      try {
        return [code, await fetchYahooRate(code)] as const;
      } catch {
        return [code, null] as const;
      }
    })),
    Promise.all((Object.keys(SYNTHETIC_ACTUAL_SYMBOLS) as SyntheticActualCode[]).map(async (code) => {
      try {
        return [code, await fetchSyntheticActual(code)] as const;
      } catch {
        return [code, null] as const;
      }
    })),
  ]);
  const rates: Record<string, DirectRate> = {};
  for (const [code, rate] of baseEntries) if (rate) rates[code] = rate;
  const syntheticSources: Record<string, DirectRate> = {};
  for (const code of Object.keys(SYNTHETIC_SOURCE_SYMBOLS) as SyntheticSourceCode[]) {
    const rate = rates[code];
    if (rate) syntheticSources[code] = rate;
  }
  const syntheticActuals: Record<string, DirectRate> = {};
  for (const [code, rate] of syntheticActualEntries) if (rate) syntheticActuals[code] = rate;
  const usdJpy = rates["USD/JPY"];
  const eurJpy = rates["EUR/JPY"];
  const gbpJpy = rates["GBP/JPY"];
  const audJpy = rates["AUD/JPY"];
  const cross = (left: DirectRate, right: DirectRate, operation: "multiply" | "divide"): DirectRate => ({
    price: operation === "multiply" ? left.price * right.price : left.price / right.price,
    timestamp: Math.min(left.timestamp, right.timestamp),
  });
  if (eurJpy && usdJpy) rates["EUR/USD"] = cross(eurJpy, usdJpy, "divide");
  if (gbpJpy && usdJpy) rates["GBP/USD"] = cross(gbpJpy, usdJpy, "divide");
  if (audJpy && usdJpy) rates["AUD/USD"] = cross(audJpy, usdJpy, "divide");
  const eurUsd = rates["EUR/USD"];
  const gbpUsd = rates["GBP/USD"];
  const audUsd = rates["AUD/USD"];
  if (eurUsd && gbpUsd) rates["EUR/GBP"] = cross(eurUsd, gbpUsd, "divide");
  if (eurUsd && audUsd) rates["EUR/AUD"] = cross(eurUsd, audUsd, "divide");
  if (gbpUsd && audUsd) rates["GBP/AUD"] = cross(gbpUsd, audUsd, "divide");

  if (Object.keys(rates).length === 0) {
    return NextResponse.json(
      { error: "レート取得失敗" },
      { status: 502, headers: { "Cache-Control": "no-store, no-cache, max-age=0, must-revalidate", "CDN-Cache-Control": "no-store" } },
    );
  }

  return NextResponse.json({
    rates,
    syntheticSources,
    syntheticActuals,
    fetchedAt: Math.floor(Date.now() / 1000),
    source: "Yahoo Finance",
    rateConstruction: "USD/JPY, EUR/JPY, GBP/JPY, AUD/JPY direct; USD crosses and remaining crosses derived from them",
  }, { headers: { "Cache-Control": "no-store, no-cache, max-age=0, must-revalidate", "CDN-Cache-Control": "no-store" } });
}
