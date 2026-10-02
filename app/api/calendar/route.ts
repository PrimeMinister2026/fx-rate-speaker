import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";

const SOURCE = "https://nfs.faireconomy.media/ff_calendar_thisweek.json";
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
    const response = await fetch(SOURCE, {
      cache: "no-store",
      headers: { "User-Agent": "FX-Rate-Speaker/1.0" },
      signal: controller.signal,
    });
    if (!response.ok) throw new Error(`calendar ${response.status}`);
    const source = await response.json() as SourceEvent[];
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
      headers: { "Cache-Control": "no-store, max-age=0" },
    });
  } catch (error) {
    return NextResponse.json({ error: "経済指標カレンダーを取得できませんでした", events: [] }, { status: 503 });
  } finally {
    clearTimeout(timeout);
  }
}
