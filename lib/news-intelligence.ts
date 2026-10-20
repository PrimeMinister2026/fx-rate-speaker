export type CauseConfidence = "CONFIRMED" | "LIKELY" | "UNKNOWN";

export type CauseNews = {
  id: string;
  title: string;
  summary: string;
  source: string;
  publishedAt: number;
  currencies: string[];
  level: "NEWS_L1" | "NEWS_L2" | "NEWS_L3";
  explicitMarketCause?: boolean;
};

export type CauseCalendarEvent = {
  id: string;
  title: string;
  currency: string;
  scheduledAt: number;
  level: "L2" | "L3";
  actual?: string;
  forecast?: string;
  previous?: string;
};

const CAUSE_LOOKBACK_MS = 15 * 60 * 1000;

export function numericEconomicValue(value?: string) {
  if (!value) return null;
  const match = value.replace(/,/g, "").match(/(-?\d+(?:\.\d+)?)\s*([KMB])?/i);
  if (!match) return null;
  const multiplier = match[2]?.toUpperCase() === "K" ? 1_000
    : match[2]?.toUpperCase() === "M" ? 1_000_000
      : match[2]?.toUpperCase() === "B" ? 1_000_000_000 : 1;
  return Number(match[1]) * multiplier;
}

export function economicSurprise(event: CauseCalendarEvent) {
  const actual = numericEconomicValue(event.actual);
  const forecast = numericEconomicValue(event.forecast);
  if (actual === null || forecast === null) return null;
  const difference = actual - forecast;
  const scale = Math.max(Math.abs(forecast), 1);
  const ratio = Math.abs(difference) / scale;
  const meaningful = Math.abs(difference) >= Math.max(scale * 0.05, event.actual?.includes("%") ? 0.1 : 0.1);
  return { actual, forecast, difference, ratio, meaningful };
}

function relatedCurrencies(pair: string) {
  return new Set(pair.split("/").filter(Boolean));
}

export function findRapidCause(
  pair: string,
  detectedAt: number,
  news: CauseNews[],
  calendar: CauseCalendarEvent[],
) {
  const currencies = relatedCurrencies(pair);
  const withinLookback = (timestamp: number) => timestamp <= detectedAt && timestamp >= detectedAt - CAUSE_LOOKBACK_MS;
  const relatedNews = news
    .filter((item) => withinLookback(item.publishedAt) && item.currencies.some((currency) => currencies.has(currency)))
    .sort((left, right) => right.publishedAt - left.publishedAt);
  const confirmed = relatedNews.find((item) => item.explicitMarketCause);
  if (confirmed) {
    return {
      confidence: "CONFIRMED" as CauseConfidence,
      label: confirmed.title,
      text: `${confirmed.source}は「${confirmed.title}」を値動きの材料として明示しています。`,
      sourceId: confirmed.id,
    };
  }

  const releases = calendar
    .filter((event) => withinLookback(event.scheduledAt) && currencies.has(event.currency) && event.actual)
    .map((event) => ({ event, surprise: economicSurprise(event) }))
    .filter((item) => item.event.level === "L3" || item.surprise?.meaningful)
    .sort((left, right) => right.event.scheduledAt - left.event.scheduledAt);
  if (releases[0]) {
    const event = releases[0].event;
    return {
      confidence: "LIKELY" as CauseConfidence,
      label: event.title,
      text: `直前の${event.title}が材料になっている可能性があります。`,
      sourceId: event.id,
    };
  }

  const likely = relatedNews.find((item) => item.level === "NEWS_L3" || item.level === "NEWS_L2");
  if (likely) {
    return {
      confidence: "LIKELY" as CauseConfidence,
      label: likely.title,
      text: `直前の${likely.source}発表が材料になっている可能性があります。`,
      sourceId: likely.id,
    };
  }

  return {
    confidence: "UNKNOWN" as CauseConfidence,
    label: "明確な材料なし",
    text: "現時点で明確な材料は確認できません。",
    sourceId: `unknown:${Math.floor(detectedAt / 60_000)}`,
  };
}

export function calendarResultSpeech(event: CauseCalendarEvent) {
  const values = [event.actual && `結果${event.actual}`, event.forecast && `予想${event.forecast}`, event.previous && `前回${event.previous}`]
    .filter(Boolean).join("、");
  const surprise = economicSurprise(event);
  const comparison = surprise && surprise.difference !== 0
    ? `予想を${surprise.difference > 0 ? "上回りました" : "下回りました"}。`
    : surprise ? "予想と一致しました。" : "";
  return `${event.title}。${values}。${comparison}`;
}
