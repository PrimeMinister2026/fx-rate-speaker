import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";

const SOURCES = [
  "https://nfs.faireconomy.media/ff_calendar_thisweek.json",
  "https://cdn-nfs.faireconomy.media/ff_calendar_thisweek.json",
];
const UPSTREAM_CACHE_MS = 5 * 60 * 1000;
const SOURCE_TIMEOUT_MS = 7_000;
let cachedSource: SourceEvent[] | null = null;
let cachedAt = 0;
const CURRENCIES = new Set(["USD", "JPY", "EUR", "GBP", "AUD"]);
const KEY_EVENT = /CPI|PCE|GDP|PMI|ISM|Non-Farm|Payroll|Employment|Unemployment|Average Hourly|Retail Sales|Rate Statement|Interest Rate|Monetary Policy|FOMC|Federal Funds|BOJ|ECB|BOE|RBA|Cash Rate|Policy Rate/i;
const TOP_EVENT = /Rate Statement|Interest Rate|Monetary Policy|FOMC|Federal Funds|BOJ|ECB|BOE|RBA|Cash Rate|Policy Rate|Non-Farm|CPI/i;

type SourceEvent = {
  title?: string;
  country?: string;
  date?: string;
  impact?: string;
  forecast?: string;
  previous?: string;
  actual?: string;
};

function clean(value?: string) {
  return value?.trim() || undefined;
}

async function fetchSource(url: string) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), SOURCE_TIMEOUT_MS);
  try {
    const response = await fetch(url, {
      cache: "no-store",
      headers: {
        Accept: "application/json,text/plain,*/*",
        "User-Agent": "Mozilla/5.0 (compatible; FX-Rate-Speaker/1.0)",
      },
      signal: controller.signal,
    });
    if (!response.ok) throw new Error(`calendar ${response.status}`);
    const data = await response.json() as SourceEvent[];
    if (!Array.isArray(data) || !data.length) throw new Error("calendar empty");
    return { data, url };
  } finally {
    clearTimeout(timeout);
  }
}

export async function GET() {
  try {
    let source = cachedSource;
    let sourceUsed = "memory-cache";
    const nowForCache = Date.now();

    if (!source || nowForCache - cachedAt >= UPSTREAM_CACHE_MS) {
      const results = await Promise.allSettled(SOURCES.map((url) => fetchSource(url)));
      const success = results.find((result): result is PromiseFulfilledResult<{ data: SourceEvent[]; url: string }> => result.status === "fulfilled");
      if (success) {
        source = success.value.data;
        sourceUsed = success.value.url;
        cachedSource = source;
        cachedAt = nowForCache;
      } else if (!source) {
        const reason = results
          .map((result) => result.status === "rejected" ? String(result.reason) : "")
          .filter(Boolean)
          .join(" | ");
        throw new Error(reason || "calendar unavailable");
      } else {
        sourceUsed = "stale-memory-cache";
      }
    }

    const now = Date.now();
    const events = source.flatMap((item) => {
      const currency = (item.country ?? "").toUpperCase();
      const scheduledAt = Date.parse(item.date ?? "");
      const title = clean(item.title);
      const important = item.impact === "High" || (item.impact === "Medium" && KEY_EVENT.test(title ?? ""));
      if (!title || !CURRENCIES.has(currency) || !Number.isFinite(scheduledAt) || !important || !KEY_EVENT.test(title)) return [];
      const level = item.impact === "High" && TOP_EVENT.test(title) ? "L3" : "L2";
      return [{
        id: `${currency}:${scheduledAt}:${title}`,
        title,
        currency,
        scheduledAt,
        level,
        actual: clean(item.actual),
        forecast: clean(item.forecast),
        previous: clean(item.previous),
      }];
    }).filter((item) => item.scheduledAt >= now - 30 * 60 * 1000)
      .sort((left, right) => left.scheduledAt - right.scheduledAt)
      .slice(0, 30);

    return NextResponse.json({
      events,
      fetchedAt: now,
      source: "Forex Factory weekly calendar",
      sourceUsed,
    }, {
      headers: { "Cache-Control": "public, max-age=60, s-maxage=300, stale-while-revalidate=600" },
    });
  } catch (error) {
    console.warn("FX Rate Speaker calendar upstream failed", error);
    return NextResponse.json(
      { error: "経済指標カレンダーを取得できませんでした", events: [], degraded: true, fetchedAt: Date.now() },
      { status: 503, headers: { "Cache-Control": "no-store" } },
    );
  }
}
