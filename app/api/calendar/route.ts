import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";

const SOURCES = [
  "https://nfs.faireconomy.media/ff_calendar_thisweek.json",
  "https://cdn-nfs.faireconomy.media/ff_calendar_thisweek.json",
];
const UPSTREAM_CACHE_MS = 5 * 60 * 1000;
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

export async function GET() {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 8_000);
  try {
    let source = cachedSource;
    const nowForCache = Date.now();
    if (!source || nowForCache - cachedAt >= UPSTREAM_CACHE_MS) {
      let lastError: Error | null = null;
      for (const url of SOURCES) {
        try {
          const response = await fetch(url, {
            cache: "no-store",
            headers: { "User-Agent": "FX-Rate-Speaker/1.0" },
            signal: controller.signal,
          });
          if (!response.ok) throw new Error(`calendar ${response.status}`);
          source = await response.json() as SourceEvent[];
          cachedSource = source;
          cachedAt = nowForCache;
          lastError = null;
          break;
        } catch (error) {
          lastError = error instanceof Error ? error : new Error(String(error));
        }
      }
      if (!source) throw lastError ?? new Error("calendar unavailable");
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
    return NextResponse.json({ events, fetchedAt: now, source: "Forex Factory weekly calendar" }, {
      headers: { "Cache-Control": "public, max-age=60, s-maxage=300, stale-while-revalidate=600" },
    });
  } catch (error) {
    return NextResponse.json({ error: "経済指標カレンダーを取得できませんでした", events: [], degraded: true }, { status: 503, headers: { "Cache-Control": "no-store" } });
  } finally {
    clearTimeout(timeout);
  }
}
