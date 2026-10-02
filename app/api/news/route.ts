import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";

type NewsLevel = "NEWS_L1" | "NEWS_L2" | "NEWS_L3";

type FeedDefinition = {
  name: string;
  url: string;
  defaultCurrencies: string[];
};

const FEEDS: FeedDefinition[] = [
  { name: "FRB", url: "https://www.federalreserve.gov/feeds/press_all.xml", defaultCurrencies: ["USD"] },
  { name: "日銀", url: "https://www.boj.or.jp/rss/whatsnew.xml", defaultCurrencies: ["JPY"] },
  { name: "ECB", url: "https://www.ecb.europa.eu/rss/press.html", defaultCurrencies: ["EUR"] },
  { name: "BOE", url: "https://www.bankofengland.co.uk/rss/news", defaultCurrencies: ["GBP"] },
  { name: "RBA", url: "https://www.rba.gov.au/rss/rss-cb-media-releases.xml", defaultCurrencies: ["AUD"] },
  { name: "米労働統計局", url: "https://www.bls.gov/feed/bls_latest.rss", defaultCurrencies: ["USD"] },
];

function decodeXml(value: string) {
  return value
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, "$1")
    .replace(/<[^>]+>/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, "\"")
    .replace(/&#39;|&apos;/g, "'")
    .replace(/&#(\d+);/g, (_, code) => String.fromCharCode(Number(code)))
    .replace(/\s+/g, " ")
    .trim();
}

function tag(item: string, names: string[]) {
  for (const name of names) {
    const match = item.match(new RegExp(`<${name}(?:\\s[^>]*)?>([\\s\\S]*?)<\\/${name}>`, "i"));
    if (match) return decodeXml(match[1]);
  }
  return "";
}

function currenciesFor(text: string, defaults: string[]) {
  const rules: Array<[string, RegExp]> = [
    ["USD", /\b(USD|US|U\.S\.|Federal Reserve|Fed|FOMC|dollar|United States)\b/i],
    ["JPY", /\b(JPY|Japan|BOJ|Bank of Japan|yen)\b|日銀|円/i],
    ["EUR", /\b(EUR|euro|ECB|European Central Bank|euro area)\b/i],
    ["GBP", /\b(GBP|sterling|BOE|Bank of England|United Kingdom|UK)\b/i],
    ["AUD", /\b(AUD|Australian dollar|RBA|Reserve Bank of Australia|Australia)\b/i],
  ];
  const detected = rules.filter(([, pattern]) => pattern.test(text)).map(([currency]) => currency);
  return [...new Set(detected.length ? detected : defaults)];
}

function classify(text: string): NewsLevel {
  if (/\b(emergency|unscheduled|intervention|currency intervention|market disruption|crisis)\b|為替介入|緊急/i.test(text)) {
    return "NEWS_L3";
  }
  if (/\b(FOMC|Federal Reserve|Bank of Japan|ECB|European Central Bank|Bank of England|Reserve Bank of Australia|interest rate|monetary policy|CPI|PCE|inflation|employment|payroll|unemployment|average hourly|GDP|ISM|PMI|retail sales|central bank|rate decision|Treasury yield|crude oil|geopolitical)\b|日銀|金融政策|政策金利|消費者物価|雇用|失業率|平均時給|小売売上|国債利回り|原油|地政学/i.test(text)) {
    return "NEWS_L2";
  }
  return "NEWS_L1";
}

function japaneseSummary(source: string, text: string, level: NewsLevel) {
  if (/intervention|為替介入/i.test(text)) return "為替介入に関する公式発表が出ています。";
  if (/employment|payroll|unemployment|雇用/i.test(text)) return "米国の雇用関連情報が公表されています。";
  if (/CPI|inflation|消費者物価|インフレ/i.test(text)) return "物価・インフレ関連の情報が公表されています。";
  if (/PCE|GDP|ISM|PMI|retail sales|小売売上/i.test(text)) return "為替市場が注目する主要経済指標の情報が公表されています。";
  if (/interest rate|monetary policy|FOMC|政策金利|金融政策/i.test(text)) return `${source}から金融政策関連の発表が出ています。`;
  return level === "NEWS_L3"
    ? `${source}から緊急性の高い発表が出ています。`
    : `${source}から新しい発表が出ています。`;
}

async function fetchFeed(feed: FeedDefinition) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 8_000);
  try {
    const response = await fetch(feed.url, {
      cache: "no-store",
      headers: { "User-Agent": "FX-Rate-Speaker/1.0" },
      signal: controller.signal,
    });
    if (!response.ok) throw new Error(`${response.status}`);
    const xml = await response.text();
    const items = xml.match(/<item(?:\s[^>]*)?>[\s\S]*?<\/item>/gi)
      ?? xml.match(/<entry(?:\s[^>]*)?>[\s\S]*?<\/entry>/gi)
      ?? [];
    return items.slice(0, 8).flatMap((item) => {
      const title = tag(item, ["title"]);
      const description = tag(item, ["description", "summary", "content"]);
      const linkTag = tag(item, ["link"]);
      const hrefMatch = item.match(/<link[^>]+href=["']([^"']+)["']/i);
      const url = hrefMatch?.[1] ?? linkTag;
      const publishedText = tag(item, ["pubDate", "published", "updated", "dc:date"]);
      const publishedAt = Date.parse(publishedText);
      if (!title || !url || !Number.isFinite(publishedAt)) return [];
      const combined = `${title} ${description}`;
      const level = classify(combined);
      return [{
        id: `${feed.name}:${url || title}`,
        source: feed.name,
        title,
        summary: japaneseSummary(feed.name, combined, level),
        url,
        publishedAt,
        currencies: currenciesFor(combined, feed.defaultCurrencies),
        level,
      }];
    });
  } finally {
    clearTimeout(timeout);
  }
}

export async function GET() {
  const settled = await Promise.allSettled(FEEDS.map(fetchFeed));
  const news = settled
    .flatMap((result) => result.status === "fulfilled" ? result.value : [])
    .filter((item) => Date.now() - item.publishedAt < 72 * 60 * 60 * 1000)
    .sort((left, right) => right.publishedAt - left.publishedAt)
    .slice(0, 30);
  const sourcesOk = settled.filter((result) => result.status === "fulfilled").length;
  if (!sourcesOk) {
    return NextResponse.json({ error: "NEWS取得元へ接続できませんでした", news: [], sourcesOk: 0 }, { status: 503 });
  }
  return NextResponse.json({ news, fetchedAt: Date.now(), sourcesOk, sourcesTotal: FEEDS.length }, {
    headers: { "Cache-Control": "no-store, max-age=0" },
  });
}
