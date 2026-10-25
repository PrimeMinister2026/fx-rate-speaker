import { NextResponse } from "next/server";
import { getChatGPTUser } from "@/app/chatgpt-auth";
import { extractAnalysisSignals, type AnalysisSourceType } from "@/lib/analysis-structure";

export const dynamic = "force-dynamic";

type NewsLevel = "NEWS_L1" | "NEWS_L2" | "NEWS_L3";
type AnalysisStance = "BUY" | "SELL" | "WAIT";
const SOURCE_TYPES = new Set<AnalysisSourceType>(["SHISHIN", "YOUTUBE", "OTHER"]);
const SUPPORTED_PAIRS = new Set(["USD/JPY", "EUR/USD", "GBP/USD", "AUD/USD", "EUR/JPY", "GBP/JPY", "AUD/JPY", "EUR/GBP", "EUR/AUD", "GBP/AUD", "FX"]);
const MAX_ANALYSIS_AGE_MS = 24 * 60 * 60 * 1000;
const MAX_ANALYSIS_LIFETIME_MS = 72 * 60 * 60 * 1000;

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
  { name: "日本財務省", url: "https://www.mof.go.jp/english/news.rss", defaultCurrencies: ["JPY"] },
];

const UPSTREAM_CACHE_MS = 60 * 1000;
const FX_RELEVANT = /\b(FOMC|Federal Reserve|Fed|Bank of Japan|ECB|European Central Bank|Bank of England|Reserve Bank of Australia|interest rate|monetary policy|CPI|PCE|inflation|employment|payroll|unemployment|wage|GDP|ISM|PMI|retail sales|currency|foreign exchange|intervention|Treasury yield|bond yield|crude oil|geopolitical)\b|日銀|金融政策|政策金利|消費者物価|雇用|失業率|賃金|国内総生産|小売売上|為替|介入|国債利回り|原油|地政学/i;
let cachedNews: Awaited<ReturnType<typeof fetchFeed>> | null = null;
let cachedAt = 0;
let cachedSourcesOk = 0;

async function database() {
  try {
    const cloudflare = await import("cloudflare:workers");
    return cloudflare.env.DB ?? null;
  } catch {
    return null;
  }
}

function adminEmails() {
  return new Set((process.env.FXRS_ADMIN_EMAILS ?? "").split(",").map((email) => email.trim().toLowerCase()).filter(Boolean));
}

async function requireAnalysisAdmin() {
  const user = await getChatGPTUser();
  if (!user) return { error: NextResponse.json({ error: "認証が必要です" }, { status: 401 }) };
  if (!adminEmails().has(user.email.toLowerCase())) {
    return { error: NextResponse.json({ error: "原稿を登録する権限がありません" }, { status: 403 }) };
  }
  return { user };
}

function asTimestamp(value: unknown) {
  if (typeof value !== "string" && typeof value !== "number") return NaN;
  const parsed = typeof value === "number" ? value : Date.parse(value);
  return Number.isFinite(parsed) ? parsed : NaN;
}

function normalizedText(value: unknown, maximum: number) {
  return typeof value === "string" ? value.replace(/\s+/g, " ").trim().slice(0, maximum) : "";
}

function normalizedBody(value: unknown, maximum: number) {
  return typeof value === "string"
    ? value.replace(/\r/g, "").replace(/[\t ]+/g, " ").replace(/\n{3,}/g, "\n\n").trim().slice(0, maximum)
    : "";
}

async function dedupeKey(parts: string[]) {
  const bytes = new TextEncoder().encode(parts.join("\n").toLowerCase());
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

async function activeSignals(now = Date.now()) {
  const db = await database();
  if (!db) return [];
  const result = await db.prepare(`SELECT id, analysis_id, publish_at, analysis_at, expires_at, source_type, pair, stance,
      level_low, level_high, trigger, condition_text, invalidation_text, source_excerpt, message
    FROM analysis_signals WHERE publish_at <= ? AND expires_at > ? ORDER BY publish_at DESC LIMIT 80`).bind(now, now).all<{
      id: string; analysis_id: string; publish_at: number; analysis_at: number; expires_at: number; source_type: AnalysisSourceType;
      pair: string; stance: AnalysisStance; level_low: number; level_high: number; trigger: string; condition_text: string;
      invalidation_text: string; source_excerpt: string; message: string;
    }>();
  return (result.results ?? []).map((item) => ({
    id: item.id,
    analysisId: item.analysis_id,
    sourceType: item.source_type,
    pair: item.pair,
    stance: item.stance,
    levelLow: item.level_low,
    levelHigh: item.level_high,
    trigger: item.trigger,
    conditionText: item.condition_text,
    invalidationText: item.invalidation_text,
    sourceExcerpt: item.source_excerpt,
    message: item.message,
    publishAt: item.publish_at,
    analysisAt: item.analysis_at,
    expiresAt: item.expires_at,
  }));
}

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
      if (!FX_RELEVANT.test(combined)) return [];
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
  const signals = await activeSignals();
  if (cachedNews && Date.now() - cachedAt < UPSTREAM_CACHE_MS) {
    return NextResponse.json({ news: cachedNews, signals, fetchedAt: cachedAt, sourcesOk: cachedSourcesOk, sourcesTotal: FEEDS.length, cache: "memory" }, {
      headers: { "Cache-Control": "public, max-age=30, s-maxage=60, stale-while-revalidate=180" },
    });
  }
  const settled = await Promise.allSettled(FEEDS.map(fetchFeed));
  const news = settled
    .flatMap((result) => result.status === "fulfilled" ? result.value : [])
    .filter((item) => Date.now() - item.publishedAt < 72 * 60 * 60 * 1000)
    .sort((left, right) => right.publishedAt - left.publishedAt)
    .slice(0, 30);
  const sourcesOk = settled.filter((result) => result.status === "fulfilled").length;
  if (!sourcesOk) {
    if (signals.length) return NextResponse.json({ news: [], signals, fetchedAt: Date.now(), sourcesOk: 0, sourcesTotal: FEEDS.length });
    return NextResponse.json({ error: "NEWS取得元へ接続できませんでした", news: [], sourcesOk: 0 }, { status: 503 });
  }
  cachedNews = news;
  cachedAt = Date.now();
  cachedSourcesOk = sourcesOk;
  return NextResponse.json({ news, signals, fetchedAt: Date.now(), sourcesOk, sourcesTotal: FEEDS.length }, {
    headers: { "Cache-Control": "public, max-age=30, s-maxage=60, stale-while-revalidate=180" },
  });
}

export async function POST(request: Request) {
  const authorization = await requireAnalysisAdmin();
  if (authorization.error) return authorization.error;
  let payload: Record<string, unknown>;
  try { payload = await request.json() as Record<string, unknown>; }
  catch { return NextResponse.json({ error: "JSON形式が不正です" }, { status: 400 }); }

  const pair = normalizedText(payload.pair, 12);
  const stance = normalizedText(payload.stance, 4) as AnalysisStance;
  const sourceType = normalizedText(payload.sourceType, 12) as AnalysisSourceType || "SHISHIN";
  const headline = normalizedText(payload.headline, 120);
  const body = normalizedBody(payload.body, 8000);
  const analysisAt = asTimestamp(payload.analysisAt);
  const publishAt = asTimestamp(payload.publishAt);
  const expiresAt = asTimestamp(payload.expiresAt);
  const now = Date.now();
  if (!SUPPORTED_PAIRS.has(pair) || !["BUY", "SELL", "WAIT"].includes(stance) || !SOURCE_TYPES.has(sourceType) || !headline || body.length < 10) {
    return NextResponse.json({ error: "ペア・判断・見出し・本文を確認してください" }, { status: 400 });
  }
  if (![analysisAt, publishAt, expiresAt].every(Number.isFinite)
    || analysisAt > now + 60_000 || now - analysisAt > MAX_ANALYSIS_AGE_MS
    || publishAt < now - 5 * 60_000 || publishAt > expiresAt
    || expiresAt - analysisAt > MAX_ANALYSIS_LIFETIME_MS) {
    return NextResponse.json({ error: "分析基準時刻・配信日時・有効期限の関係が不正、または分析が古すぎます" }, { status: 400 });
  }
  const key = await dedupeKey([pair, stance, String(analysisAt), headline, body]);
  const id = crypto.randomUUID();
  const signals = extractAnalysisSignals({ body, pair, stance, sourceType });
  try {
    const db = await database();
    if (!db) return NextResponse.json({ error: "原稿保存先を利用できません" }, { status: 503 });
    const statements = [db.prepare(`INSERT INTO market_analyses
      (id, created_at, created_by, publish_at, analysis_at, expires_at, pair, stance, headline, body, dedupe_key)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
      .bind(id, now, authorization.user.email, publishAt, analysisAt, expiresAt, pair, stance, headline, body, key)];
    for (const signal of signals) {
      const signalKey = await dedupeKey([sourceType, signal.pair, String(signal.levelLow), String(signal.levelHigh), signal.trigger, signal.conditionText, String(expiresAt)]);
      statements.push(db.prepare(`INSERT OR IGNORE INTO analysis_signals
        (id, analysis_id, created_at, publish_at, analysis_at, expires_at, source_type, pair, stance, level_low, level_high,
          trigger, condition_text, invalidation_text, source_excerpt, message, dedupe_key)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
        .bind(crypto.randomUUID(), id, now, publishAt, analysisAt, expiresAt, sourceType, signal.pair, signal.stance,
          signal.levelLow, signal.levelHigh, signal.trigger, signal.conditionText, signal.invalidationText,
          signal.sourceExcerpt, signal.message, signalKey));
    }
    await db.batch(statements);
  } catch (error) {
    if (String(error).toLowerCase().includes("unique")) return NextResponse.json({ error: "同じ原稿はすでに登録されています" }, { status: 409 });
    console.error("FX Rate Speaker analysis registration failed", error);
    return NextResponse.json({ error: "原稿を保存できませんでした" }, { status: 500 });
  }
  return NextResponse.json({ id, registeredAt: now, extractedSignals: signals }, { status: 201, headers: { "Cache-Control": "no-store" } });
}
