import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";

const SOURCE_SYMBOLS = {
  "USD/JPY": "USDJPY=X",
  "EUR/JPY": "EURJPY=X",
  "GBP/JPY": "GBPJPY=X",
  "AUD/JPY": "AUDJPY=X",
} as const;

type SourceCode = keyof typeof SOURCE_SYMBOLS;
type HistoryPoint = { price: number; timestamp: number };
export type HistorySnapshot = { histories: Record<string, HistoryPoint[]>; fetchedAt: number; source: string };
type YahooChart = {
  timestamp?: Array<number | null>;
  indicators?: { quote?: Array<{ close?: Array<number | null> }> };
};

const yahooHeaders = {
  Accept: "application/json",
  "User-Agent": "Mozilla/5.0 (compatible; FX-Rate-Speaker/1.0)",
};

function validHistory(chart: YahooChart | undefined) {
  const timestamps = chart?.timestamp ?? [];
  const closes = chart?.indicators?.quote?.[0]?.close ?? [];
  const points: HistoryPoint[] = [];
  for (let index = 0; index < Math.min(timestamps.length, closes.length); index += 1) {
    const timestamp = timestamps[index];
    const price = closes[index];
    if (Number.isFinite(timestamp) && Number.isFinite(price) && Number(price) > 0) {
      points.push({ timestamp: Number(timestamp), price: Number(price) });
    }
  }
  return points.slice(-70);
}

async function fetchYahooHistory(code: SourceCode) {
  const symbol = SOURCE_SYMBOLS[code];
  for (const host of ["query2.finance.yahoo.com", "query1.finance.yahoo.com"]) {
    const url = `https://${host}/v8/finance/chart/${encodeURIComponent(symbol)}?interval=1m&range=1d&_=${Date.now()}`;
    const response = await fetch(url, { cache: "no-store", headers: yahooHeaders });
    if (!response.ok) continue;
    const data = await response.json() as { chart?: { result?: YahooChart[] } };
    const points = validHistory(data.chart?.result?.[0]);
    if (points.length) return points;
  }
  return [];
}

function nearest(points: HistoryPoint[], timestamp: number) {
  let result: HistoryPoint | null = null;
  let distance = Number.POSITIVE_INFINITY;
  for (const point of points) {
    const nextDistance = Math.abs(point.timestamp - timestamp);
    if (nextDistance < distance) {
      result = point;
      distance = nextDistance;
    }
  }
  return distance <= 75 ? result : null;
}

function derivedRates(usdJpy: number, eurJpy: number, gbpJpy: number, audJpy: number) {
  const eurUsd = eurJpy / usdJpy;
  const gbpUsd = gbpJpy / usdJpy;
  const audUsd = audJpy / usdJpy;
  return {
    "USD/JPY": usdJpy,
    "EUR/USD": eurUsd,
    "GBP/USD": gbpUsd,
    "AUD/USD": audUsd,
    "EUR/JPY": eurJpy,
    "GBP/JPY": gbpJpy,
    "AUD/JPY": audJpy,
    "EUR/GBP": eurUsd / gbpUsd,
    "EUR/AUD": eurUsd / audUsd,
    "GBP/AUD": gbpUsd / audUsd,
  };
}

let cached: { at: number; value: HistorySnapshot } | undefined;
let pending: Promise<HistorySnapshot> | undefined;

export async function currentHistory(): Promise<HistorySnapshot> {
  if (cached && Date.now() - cached.at < 60_000) return cached.value;
  if (pending) return pending;
  pending = (async () => {
  const entries = await Promise.all((Object.keys(SOURCE_SYMBOLS) as SourceCode[]).map(async (code) => {
    try {
      return [code, await fetchYahooHistory(code)] as const;
    } catch {
      return [code, []] as const;
    }
  }));
  const sources = Object.fromEntries(entries) as Record<SourceCode, HistoryPoint[]>;
  const anchor = sources["USD/JPY"];
  const histories: Record<string, HistoryPoint[]> = {};

  for (const anchorPoint of anchor) {
    const eur = nearest(sources["EUR/JPY"], anchorPoint.timestamp);
    const gbp = nearest(sources["GBP/JPY"], anchorPoint.timestamp);
    const aud = nearest(sources["AUD/JPY"], anchorPoint.timestamp);
    if (!eur || !gbp || !aud) continue;
    const rates = derivedRates(anchorPoint.price, eur.price, gbp.price, aud.price);
    for (const [code, price] of Object.entries(rates)) {
      if (!Number.isFinite(price) || price <= 0) continue;
      (histories[code] ??= []).push({ price, timestamp: anchorPoint.timestamp });
    }
  }

  if (!Object.keys(histories).length) throw new Error("過去レート取得失敗");
  const value = {
    histories,
    fetchedAt: Math.floor(Date.now() / 1000),
    source: "Yahoo Finance 1m close",
  };
  cached = { at: Date.now(), value };
  return value;
  })();
  try { return await pending; } finally { pending = undefined; }
}

export async function GET() {
  try {
    return NextResponse.json(await currentHistory(), { headers: { "Cache-Control": "private, max-age=30" } });
  } catch {
    return NextResponse.json({ error: "過去レート取得失敗" }, { status: 502, headers: { "Cache-Control": "no-store" } });
  }
}
