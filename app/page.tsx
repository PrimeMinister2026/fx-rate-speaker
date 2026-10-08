"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import {
  analyzeMovement,
  appendRatePoint,
  RAPID_LONG_WINDOW,
  RAPID_SHORT_WINDOW,
  recentMovePips,
  transitionMovement,
  TREND_WINDOW,
  VOLATILITY_WINDOW,
  type MovementNotification,
  type MovementState,
  type MovementTracker,
  type RatePoint,
} from "@/lib/movement";
import {
  appendMode2PricePoint,
  buildMode2Frequencies,
  MODE2_POINT_COUNT,
  type Mode2PricePoint,
} from "@/lib/sound-mode";
import {
  SYNTHETIC_SYMBOLS,
  applyCurrentCorrection,
  emptySyntheticLearningState,
  isSyntheticJumpValid,
  learnFromYahoo,
  rawSyntheticFor,
  type SyntheticLearningState,
  type SyntheticPoint,
  type SyntheticStatus,
  type SyntheticSymbol,
} from "@/lib/synthetic";
import { FX_RATE_SPEAKER_VERSION_LABEL } from "@/lib/version";
import {
  CURRENCY_STRENGTH_WINDOWS,
  STRENGTH_CURRENCIES,
  STRENGTH_PAIR_CODES,
  STRENGTH_VERTEX_ORDER,
  calculateCurrencyStrength,
  type CurrencyCode,
  type CurrencyStrength,
} from "@/lib/currency-strength";

const PAIRS = [
  { code: "USD/JPY", name: "ドル円", yen: true },
  { code: "EUR/USD", name: "ユーロドル", yen: false },
  { code: "GBP/USD", name: "ポンドドル", yen: false },
  { code: "AUD/USD", name: "オージードル", yen: false },
  { code: "EUR/JPY", name: "ユーロ円", yen: true },
  { code: "GBP/JPY", name: "ポンド円", yen: true },
  { code: "AUD/JPY", name: "オージー円", yen: true },
  { code: "EUR/GBP", name: "ユーロポンド", yen: false },
  { code: "EUR/AUD", name: "ユーロオージー", yen: false },
  { code: "GBP/AUD", name: "ポンドオージー", yen: false },
] as const;

const AUTO_STOP_SECONDS = 3 * 60 * 60;
const DEFAULT_SPEECH_RATE = 1.5;
const COMMENTARY_VISIBLE_LIMIT = 8;
const COMMENTARY_HISTORY_RETENTION_LIMIT = 40;
const HISTORY_RAPID_TTL_MS = 30 * 60 * 1000;
const HISTORY_IMPORTANT_TTL_MS = 20 * 60 * 1000;
const HISTORY_NORMAL_TTL_MS = 10 * 60 * 1000;
const COMMENTARY_COOLDOWN_MS = 3 * 60 * 1000;
const RAPID_COMMENTARY_COOLDOWN_MS = 90 * 1000;
const BREAKOUT_COOLDOWN_MS = 4 * 60 * 1000;
const SUMMARY_INTERVAL_MS = 5 * 60 * 1000;
const SPARKLINE_DISPLAY_POINT_COUNT = 30;
const SPARKLINE_HISTORY_POINT_COUNT = 60;
const SPARKLINE_LONG_WINDOW = 60;
const SPARKLINE_BASE_WINDOW = 30;
const SPARKLINE_MID_WINDOW = 15;
const SPARKLINE_RECENT_WINDOW = MODE2_POINT_COUNT;
const BREAKOUT_LOOKBACK_SECONDS = 15 * 60;
const BREAKOUT_RANGE_RATIO = 0.04;
const BREAKOUT_MIN_PIPS = 0.5;
const NEWS_POLL_INTERVAL_MS = 60 * 1000;
const CALENDAR_POLL_INTERVAL_MS = 5 * 60 * 1000;
const CALENDAR_STALE_MS = 15 * 60 * 1000;
const CALENDAR_POST_EVENT_MS = 20 * 60 * 1000;
const COMMENTARY_QUEUE_STALE_MS = 90 * 1000;
const NEWS_SEEN_STORAGE_KEY = "fx-rate-speaker-seen-news";
const GRAPH_RATE_POLL_MS = 10 * 1000;
const RAPID_DISPLAY_HOLD_MS = 30 * 1000;
const RAPID_AUDIO_MIN_REMAINING_MS = 15 * 1000;
const COMMENTARY_MERGE_MS = 60 * 1000;
const OANDA_SHADOW_STORAGE_KEY = "fx-rate-speaker-oanda-shadow-v1";
const OANDA_PRIMARY_STALE_MS = 60 * 1000;
const OANDA_SHADOW_MAX_RECORDS = 5000;
const SYNTHETIC_STORAGE_KEY = "fx-rate-speaker-synthetic-learning-v1";
const MARKET_NOTICE_STORAGE_KEY = "fx-rate-speaker-market-notices-v3";
const CALENDAR_AMBER_MINUTES = 30;
const CALENDAR_ORANGE_MINUTES = 10;
const CALENDAR_RED_MINUTES = 5;
const CALENDAR_POST_ALERT_MINUTES = 10;
const STRENGTH_VISUAL_MAX_DIFFERENCE = 18;
const STRENGTH_VISUAL_EXPONENT = 1.55;
const STRENGTH_LINE_MIN_WIDTH = 0.7;
const STRENGTH_LINE_MAX_WIDTH = 8.2;
const STRENGTH_LINE_MIN_OPACITY = 0.18;
const STRENGTH_LINE_MAX_OPACITY = 1;
const STRENGTH_TREND_HISTORY = { 60: 6, 30: 5, 15: 4, 7: 3 } as const;
const STRENGTH_SIGNIFICANT_DIFFERENCE = 0.75;

type Rate = { price: number; timestamp: number };
type RateMap = Record<string, Rate>;
type RateSource = "OANDA" | "OANDA_SYNTHETIC" | "YAHOO";
type RateResponse = { rates?: RateMap; syntheticSources?: RateMap; syntheticActuals?: RateMap; fetchedAt?: number; error?: string };
type Direction = "up" | "down" | "unchanged";
type PlaybackCue = Direction | MovementNotification;
type AudioMode = "mode2" | "mode3" | "mode4";
type CommentaryLevel = "normal" | "important" | "rapid";
type NewsLevel = "NEWS_L1" | "NEWS_L2" | "NEWS_L3";
type LeadSound = "NONE" | "PRICE_RAPID" | NewsLevel;
const AUDIO_EVENT_PRIORITY: Record<LeadSound, number> = {
  PRICE_RAPID: 60,
  NEWS_L3: 50,
  NEWS_L2: 40,
  NEWS_L1: 30,
  NONE: 20,
};
type CommentaryEntry = {
  id: string;
  timestamp: number;
  source: "COMMENTARY" | "NEWS";
  pair: string;
  kind: string;
  text: string;
  level: CommentaryLevel;
  currency?: string;
  importance?: NewsLevel;
  priceRelation?: string;
  headline?: string;
  url?: string;
};
type NewsItem = {
  id: string;
  source: string;
  title: string;
  summary: string;
  url: string;
  publishedAt: number;
  currencies: string[];
  level: NewsLevel;
};
type NewsResponse = { news?: NewsItem[]; error?: string; sourcesOk?: number; sourcesTotal?: number };
type CalendarEvent = {
  id: string;
  title: string;
  currency: string;
  scheduledAt: number;
  level: "L2" | "L3";
  actual?: string;
  forecast?: string;
  previous?: string;
};
type CalendarResponse = { events?: CalendarEvent[]; fetchedAt?: number; error?: string };
type OandaShadowMessage = {
  symbol: string;
  bid: number;
  ask: number;
  mid: number;
  providerTimestamp: string;
  receivedTimestamp: number;
};
type OandaShadowRecord = OandaShadowMessage & {
  delta: number | null;
  yahooPrice: number | null;
  yahooTimestamp: number | null;
  differencePips: number | null;
};
type CommentaryCandidate = Omit<CommentaryEntry, "id" | "timestamp"> & {
  eventKey: string;
  priority: number;
  cooldownMs?: number;
};
type MovementSnapshot = {
  notification: MovementNotification | null;
  state: MovementState;
  recentMove: number | null;
  rapidMovePips: number | null;
};
type RateDisplayState = {
  direction: Direction;
  movement: MovementState;
};

type QueuedCommentary = CommentaryEntry & { priority: number };

type FlowSnapshot = {
  overall: Direction;
  short: Direction;
  recent: Direction;
};

type MarketNotice = {
  id: string;
  message: string;
  start: string;
  end: string;
  weekdays: number[];
  timeBasis: MarketNoticeTimeBasis;
};

type MarketNoticeTimeBasis = "fixed" | "london" | "new_york";

const MARKET_NOTICE_TIME_ZONES: Record<MarketNoticeTimeBasis, string> = {
  fixed: "Asia/Tokyo",
  london: "Europe/London",
  new_york: "America/New_York",
};

const MARKET_NOTICE_TIME_BASIS_OPTIONS: Array<{ value: MarketNoticeTimeBasis; label: string }> = [
  { value: "fixed", label: "日本時間固定" },
  { value: "london", label: "LDN夏冬対応" },
  { value: "new_york", label: "NY夏冬対応" },
];

const WEEKDAYS = [
  { value: 1, label: "月" }, { value: 2, label: "火" }, { value: 3, label: "水" },
  { value: 4, label: "木" }, { value: 5, label: "金" }, { value: 6, label: "土" },
  { value: 0, label: "日" },
] as const;
const WEEKDAYS_ONLY = [1, 2, 3, 4, 5];
const DEFAULT_MARKET_NOTICES: MarketNotice[] = [
  { id: "monday-open", message: "週明け・窓と薄い流動性に注意", start: "07:00", end: "08:45", weekdays: [1], timeBasis: "fixed" },
  { id: "tokyo-pre", message: "TKY勢参入前・初動準備", start: "08:45", end: "09:00", weekdays: WEEKDAYS_ONLY, timeBasis: "fixed" },
  { id: "tokyo-open", message: "TKY勢参入・初動と円相場に注意", start: "09:00", end: "09:30", weekdays: WEEKDAYS_ONLY, timeBasis: "fixed" },
  { id: "tokyo-fix", message: "仲値前後・ドル円の反転に注意", start: "09:50", end: "10:10", weekdays: WEEKDAYS_ONLY, timeBasis: "fixed" },
  { id: "london-pre", message: "LDN勢参入前・ポジション解消注意", start: "07:00", end: "08:00", weekdays: WEEKDAYS_ONLY, timeBasis: "london" },
  { id: "london-open", message: "LDN勢参入・初動と欧州通貨に注意", start: "08:00", end: "08:30", weekdays: WEEKDAYS_ONLY, timeBasis: "london" },
  { id: "new-york-data", message: "米指標集中時間・USD急変注意", start: "08:20", end: "08:40", weekdays: WEEKDAYS_ONLY, timeBasis: "new_york" },
  { id: "new-york-pre", message: "NY勢参入前・欧米の引継ぎ注意", start: "07:45", end: "08:00", weekdays: WEEKDAYS_ONLY, timeBasis: "new_york" },
  { id: "new-york-open", message: "NY勢参入・初動と逆流に注意", start: "08:00", end: "08:30", weekdays: WEEKDAYS_ONLY, timeBasis: "new_york" },
  { id: "option-cut", message: "NYオプションカット前後注意", start: "09:50", end: "10:10", weekdays: WEEKDAYS_ONLY, timeBasis: "new_york" },
  { id: "friday-close", message: "週末・ポジション調整と手仕舞い注意", start: "10:30", end: "10:50", weekdays: [5], timeBasis: "new_york" },
  { id: "london-fix", message: "LDNフィックス前後・急変注意", start: "15:50", end: "16:10", weekdays: WEEKDAYS_ONLY, timeBasis: "london" },
];
const MARKET_PROVERBS = [
  "休むも相場",
  "待つも相場",
  "相場は明日もある",
  "利食い千人力",
  "頭と尻尾はくれてやれ",
  "人の行く裏に道あり花の山",
  "見切り千両、損切り万両",
  "売るべし、買うべし、休むべし",
  "もうはまだなり、まだはもうなり",
  "押し目待ちに押し目なし",
  "戻り待ちに戻りなし",
  "天井三日、底百日",
  "相場は相場に聞け",
  "山高ければ谷深し",
  "閑散に売りなし",
  "上げ百日、下げ十日",
  "落ちるナイフはつかむな",
  "トレンドは友、逆らわない",
  "損小利大を忘れない",
  "予想より値動きを見る",
  "迷ったら見送る",
  "一度の勝負に賭けすぎない",
  "含み益は利益ではない",
  "負けを取り返そうとしない",
  "伸びた後ほど追いかけない",
  "急変時はまず深呼吸",
  "勝つより先に生き残る",
  "根拠が消えたら手仕舞う",
  "小さな損で大きな損を防ぐ",
  "相場に絶対はない",
  "ポジションを持たない勇気",
  "時間帯が変われば流れも変わる",
  "指標前は無理をしない",
  "利益は伸ばし、損は限定する",
  "焦りは判断を曇らせる",
  "得意な形だけを待つ",
  "記録は感覚より強い",
];

const AUDIO_MODE_STORAGE_KEY = "fx-rate-speaker-audio-mode";

function spokenPrice(price: number, yen: boolean) {
  return price.toFixed(yen ? 3 : 5);
}

function displayPrice(price: number, yen: boolean) {
  return price.toFixed(yen ? 3 : 5);
}

function formatRemaining(seconds: number) {
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  const secs = seconds % 60;
  return [hours, minutes, secs].map((value) => String(value).padStart(2, "0")).join(":");
}

function isClockAlertWindow(timestamp: number) {
  const parts = Object.fromEntries(new Intl.DateTimeFormat("en-US", {
    timeZone: "Asia/Tokyo",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  }).formatToParts(timestamp).map((part) => [part.type, part.value]));
  const minute = Number(parts.minute);
  const second = Number(parts.second);
  const within = (startMinute: number, endMinute: number) => {
    if (startMinute <= endMinute) {
      return (minute > startMinute || (minute === startMinute && second >= 0))
        && (minute < endMinute || (minute === endMinute && second === 0));
    }
    return minute > startMinute
      || (minute === startMinute && second >= 0)
      || minute < endMinute
      || (minute === endMinute && second === 0);
  };
  return within(50, 5) || within(20, 35);
}

function formatLiveDateTime(timestamp: number) {
  const parts = Object.fromEntries(new Intl.DateTimeFormat("en-GB", {
    timeZone: "Asia/Tokyo",
    hour12: false,
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    weekday: "short",
    day: "2-digit",
    month: "short",
    year: "numeric",
  }).formatToParts(timestamp).map((part) => [part.type, part.value]));
  return `${parts.hour}:${parts.minute}:${parts.second} ${parts.weekday} ${parts.day} ${parts.month} ${parts.year}`;
}

function marketClock(timestamp: number, timeZone = "Asia/Tokyo") {
  const parts = Object.fromEntries(new Intl.DateTimeFormat("en-GB", {
    timeZone,
    weekday: "short",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).formatToParts(timestamp).map((part) => [part.type, part.value]));
  const weekday = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].indexOf(parts.weekday);
  return { weekday, minute: Number(parts.hour) * 60 + Number(parts.minute) };
}

function timeToMinute(value: string) {
  const [hour, minute] = value.split(":").map(Number);
  return hour * 60 + minute;
}

function activeMarketNotice(notices: MarketNotice[], timestamp: number) {
  return notices.find((notice) => {
    const now = marketClock(timestamp, MARKET_NOTICE_TIME_ZONES[notice.timeBasis]);
    if (!notice.weekdays.includes(now.weekday)) return false;
    const start = timeToMinute(notice.start);
    const end = timeToMinute(notice.end);
    return start <= end
      ? now.minute >= start && now.minute < end
      : now.minute >= start || now.minute < end;
  }) ?? null;
}

function timeZoneOffsetMinutes(timestamp: number, timeZone: string) {
  const parts = Object.fromEntries(new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hourCycle: "h23",
  }).formatToParts(timestamp).map((part) => [part.type, part.value]));
  const asUtc = Date.UTC(Number(parts.year), Number(parts.month) - 1, Number(parts.day), Number(parts.hour), Number(parts.minute), Number(parts.second));
  return Math.round((asUtc - timestamp) / 60_000);
}

function formatClockMinute(value: number) {
  const minute = ((value % 1440) + 1440) % 1440;
  return `${String(Math.floor(minute / 60)).padStart(2, "0")}:${String(minute % 60).padStart(2, "0")}`;
}

function marketNoticeDisplayRange(notice: MarketNotice, timestamp: number) {
  if (notice.timeBasis === "fixed") return `${notice.start}–${notice.end}`;
  const sourceZone = MARKET_NOTICE_TIME_ZONES[notice.timeBasis];
  const offset = timeZoneOffsetMinutes(timestamp, "Asia/Tokyo") - timeZoneOffsetMinutes(timestamp, sourceZone);
  return `${formatClockMinute(timeToMinute(notice.start) + offset)}–${formatClockMinute(timeToMinute(notice.end) + offset)} JST`;
}

function marketNoticeJstTime(timeBasis: MarketNoticeTimeBasis, sourceTime: string, timestamp: number) {
  if (timeBasis === "fixed") return sourceTime;
  const sourceZone = MARKET_NOTICE_TIME_ZONES[timeBasis];
  const offset = timeZoneOffsetMinutes(timestamp, "Asia/Tokyo") - timeZoneOffsetMinutes(timestamp, sourceZone);
  return formatClockMinute(timeToMinute(sourceTime) + offset);
}

function marketNoticeSourceTime(timeBasis: MarketNoticeTimeBasis, jstTime: string, timestamp: number) {
  if (timeBasis === "fixed") return jstTime;
  const sourceZone = MARKET_NOTICE_TIME_ZONES[timeBasis];
  const offset = timeZoneOffsetMinutes(timestamp, "Asia/Tokyo") - timeZoneOffsetMinutes(timestamp, sourceZone);
  return formatClockMinute(timeToMinute(jstTime) - offset);
}

const CLASSIC_MARKET_PROVERBS = MARKET_PROVERBS.slice(0, 6);

function fallbackMarketProverb(timestamp: number) {
  const { weekday, minute } = marketClock(timestamp);
  const slot = weekday * 288 + Math.floor(minute / 5);
  if (slot % 6 === 0) {
    return CLASSIC_MARKET_PROVERBS[Math.floor(slot / 6) % CLASSIC_MARKET_PROVERBS.length];
  }
  return MARKET_PROVERBS[slot % MARKET_PROVERBS.length];
}

function movementLabel(state?: MovementState) {
  if (state === "UP_TREND") return "上昇傾向";
  if (state === "DOWN_TREND") return "下落傾向";
  if (state === "RAPID_UP") return "急上昇";
  if (state === "RAPID_DOWN") return "急下落";
  return "通常";
}

function movementSymbol(state?: MovementState) {
  if (state === "UP_TREND") return "↑";
  if (state === "DOWN_TREND") return "↓";
  if (state === "RAPID_UP") return "↑↑";
  if (state === "RAPID_DOWN") return "↓↓";
  return "";
}

function directionLabel(direction?: Direction) {
  if (direction === "up") return "上昇";
  if (direction === "down") return "下落";
  if (direction === "unchanged") return "変わらず";
  return "待機";
}

function visualDirection(history: Mode2PricePoint[], fallback?: Direction): Direction {
  if (history.length < 2) return fallback ?? "unchanged";
  const first = history[0].price;
  const last = history.at(-1)!.price;
  const range = Math.max(...history.map((point) => point.price)) - Math.min(...history.map((point) => point.price));
  if (range === 0 || Math.abs(last - first) <= range * 0.08) return "unchanged";
  return last > first ? "up" : "down";
}

function flowSnapshot(history: Mode2PricePoint[], fallback: Direction = "unchanged"): FlowSnapshot {
  const overall = visualDirection(history.slice(-SPARKLINE_BASE_WINDOW), fallback);
  const short = visualDirection(history.slice(-SPARKLINE_MID_WINDOW), overall);
  const recent = visualDirection(history.slice(-SPARKLINE_RECENT_WINDOW), short);
  return { overall, short, recent };
}

function shortVolatilityLevel(history: Mode2PricePoint[], pipSize: number) {
  if (history.length < 5) return 1;
  const window = history.slice(-SPARKLINE_BASE_WINDOW);
  const moves = window.slice(1).map((point, index) =>
    Math.abs(point.price - window[index].price) / pipSize,
  ).filter((value) => Number.isFinite(value));
  if (!moves.length) return 1;
  const sorted = [...moves].sort((a, b) => a - b);
  const median = sorted[Math.floor(sorted.length / 2)] || 0;
  const recent = moves.slice(-6);
  const current = recent.reduce((sum, value) => sum + value, 0) / recent.length;
  if (median <= 0) return current > 0 ? 3 : 1;
  const ratio = current / median;
  if (ratio <= 0.45) return 1;
  if (ratio <= 0.75) return 2;
  if (ratio <= 1.35) return 3;
  if (ratio <= 2) return 4;
  return 5;
}

function normalizedPipValue(price: number, pipSize: number) {
  if (!Number.isFinite(price) || price <= 0) return null;
  const notionalYen = 100_000 * 25;
  return notionalYen * pipSize / price;
}

function lastThreeRateDigits(price: number, yen: boolean) {
  return displayPrice(price, yen).replace(/\D/g, "").slice(-3).padStart(3, "0");
}

function previousGraphGridRates(history: Mode2PricePoint[], now: number) {
  const gridSeconds = GRAPH_RATE_POLL_MS / 1000;
  const currentGridTimestamp = Math.floor(now / GRAPH_RATE_POLL_MS) * gridSeconds;
  const pointsByTimestamp = new Map(history.map((point) => [point.timestamp, point]));
  return [1, 2, 3].map((stepsBack) => pointsByTimestamp.get(currentGridTimestamp - gridSeconds * stepsBack));
}

function flowCommentary(name: string, flow: FlowSnapshot, movement: MovementState, event?: "high" | "low") {
  const { overall, short, recent } = flow;
  const rapidUp = movement === "RAPID_UP";
  const rapidDown = movement === "RAPID_DOWN";
  if (event === "high") {
    if (overall === "up" && short === "up") return `${name}、上昇傾向が続く中、直近15分の高値を明確に更新しました。`;
    if (overall === "unchanged" && recent === "up") return `${name}、横ばいから上方向へ抜け、直近15分の高値を更新しました。`;
    return `${name}、直近は反発し、15分高値を明確に更新しました。`;
  }
  if (event === "low") {
    if (overall === "down" && short === "down") return `${name}、下降傾向が続く中、直近15分の安値を明確に更新しました。`;
    if (overall === "unchanged" && recent === "down") return `${name}、横ばいから下方向へ抜け、直近15分の安値を更新しました。`;
    return `${name}、直近は反落し、15分安値を明確に更新しました。`;
  }
  if (overall === "up" && short === "up" && recent === "up") {
    return rapidUp ? `${name}、上昇傾向が続く中、上昇の勢いが強まっています。` : `${name}、上昇傾向が続いています。`;
  }
  if (overall === "down" && short === "down" && recent === "down") {
    return rapidDown ? `${name}、下降傾向が続く中、下落が強まっています。` : `${name}、下降傾向が続いています。`;
  }
  if (overall === "up" && recent === "down") return `${name}、全体は上昇傾向ですが、直近はやや反落しています。`;
  if (overall === "down" && recent === "up") return `${name}、全体は下降傾向ですが、直近は反発しています。`;
  if (overall === "unchanged" && short === "unchanged" && recent === "up") return `${name}、横ばいから上方向へ動き始めています。`;
  if (overall === "unchanged" && short === "unchanged" && recent === "down") return `${name}、横ばいから下方向へ動き始めています。`;
  if (overall === "up" && short === "unchanged" && recent === "unchanged") return `${name}、上昇後は現在いったん落ち着いています。`;
  if (overall === "down" && short === "unchanged" && recent === "unchanged") return `${name}、下降後は現在いったん落ち着いています。`;
  if (recent === "up") return `${name}、直近は上向きに動いています。`;
  if (recent === "down") return `${name}、直近は下向きに動いています。`;
  return `${name}、直近はおおむね横ばいです。`;
}

function breakoutCandidate(history: Mode2PricePoint[], pipSize: number) {
  if (history.length < 7) return null;
  const current = history.at(-1)!;
  const cutoff = current.timestamp - BREAKOUT_LOOKBACK_SECONDS;
  const prior = history.slice(0, -1).filter((point) => point.timestamp >= cutoff && point.timestamp < current.timestamp);
  if (prior.length < 6) return null;
  const priorHigh = Math.max(...prior.map((point) => point.price));
  const priorLow = Math.min(...prior.map((point) => point.price));
  const rangePoints = history.slice(-SPARKLINE_BASE_WINDOW);
  const rangePips = (Math.max(...rangePoints.map((point) => point.price)) - Math.min(...rangePoints.map((point) => point.price))) / pipSize;
  const requiredPips = Math.max(BREAKOUT_MIN_PIPS, rangePips * BREAKOUT_RANGE_RATIO);
  const highPips = (current.price - priorHigh) / pipSize;
  const lowPips = (priorLow - current.price) / pipSize;
  if (current.price > priorHigh) return { side: "high" as const, reference: priorHigh, widthPips: highPips, requiredPips, samples: prior.length };
  if (current.price < priorLow) return { side: "low" as const, reference: priorLow, widthPips: lowPips, requiredPips, samples: prior.length };
  return null;
}

function appendSparklinePoint(history: Mode2PricePoint[], point: Mode2PricePoint) {
  if (!Number.isFinite(point.price) || point.price <= 0 || !Number.isFinite(point.timestamp)) return history;
  const previous = history.at(-1);
  if (previous && point.timestamp < previous.timestamp) return history;
  if (previous && point.timestamp === previous.timestamp && point.price === previous.price) return history;
  return [...history, point].slice(-SPARKLINE_HISTORY_POINT_COUNT);
}

function directionArrow(direction: Direction) {
  return direction === "up" ? "↑" : direction === "down" ? "↓" : "→";
}

function visualStrength(history: Mode2PricePoint[]): "weak" | "medium" | "strong" {
  if (history.length < 2) return "weak";
  const prices = history.map((point) => point.price);
  const range = Math.max(...prices) - Math.min(...prices);
  if (range === 0) return "weak";
  const directionalShare = Math.abs(prices.at(-1)! - prices[0]) / range;
  if (directionalShare >= 0.72) return "strong";
  if (directionalShare >= 0.38) return "medium";
  return "weak";
}

function interpolateRgb(from: readonly [number, number, number], to: readonly [number, number, number], amount: number) {
  const value = from.map((channel, index) => Math.round(channel + (to[index] - channel) * amount));
  return `rgb(${value.join(",")})`;
}

function strengthVisual(difference: number) {
  const normalized = Math.max(0, Math.min(1, Math.abs(difference) / STRENGTH_VISUAL_MAX_DIFFERENCE));
  const visual = normalized ** STRENGTH_VISUAL_EXPONENT;
  const color = normalized ** 1.05;
  return {
    normalized,
    visual,
    color,
    width: STRENGTH_LINE_MIN_WIDTH + (STRENGTH_LINE_MAX_WIDTH - STRENGTH_LINE_MIN_WIDTH) * visual,
    opacity: STRENGTH_LINE_MIN_OPACITY + (STRENGTH_LINE_MAX_OPACITY - STRENGTH_LINE_MIN_OPACITY) * visual,
  };
}

function trendAwareStrengthDifference(history: number[], windowSize: number) {
  if (windowSize <= 7) {
    if (!history.length) return 0;
    const current = history.at(-1) ?? 0;
    const recent = history.slice(-3);
    const significant = recent.filter((value) => Math.abs(value) >= STRENGTH_SIGNIFICANT_DIFFERENCE);
    if (significant.length < 2) return current * 0.20;

    const positive = significant.filter((value) => value > 0);
    const negative = significant.filter((value) => value < 0);
    const dominant = positive.length >= negative.length ? positive : negative;
    if (dominant.length < 2) return current * 0.25;

    const magnitudes = dominant.map((value) => Math.abs(value)).sort((a, b) => a - b);
    const sustained = magnitudes[Math.floor(magnitudes.length / 2)] ?? 0;
    const sign = dominant[0] > 0 ? 1 : -1;
    const consistency = dominant.length / significant.length;
    const live = Math.sign(current) === sign ? Math.abs(current) : 0;
    return sign * Math.max(sustained * (0.60 + consistency * 0.25), live * 0.55);
  }
  if (!history.length) return 0;
  const current = history.at(-1) ?? 0;
  const significant = history.filter((value) => Math.abs(value) >= STRENGTH_SIGNIFICANT_DIFFERENCE);
  if (!significant.length) return current * 0.45;

  const weightedSum = significant.reduce((sum, value, index) => sum + value * (index + 1), 0);
  const dominantSign = Math.sign(weightedSum) || Math.sign(current) || 1;
  const aligned = significant.filter((value) => Math.sign(value) === dominantSign);
  const consistency = aligned.length / significant.length;
  const orderedMagnitudes = aligned.map((value) => Math.abs(value)).sort((a, b) => a - b);
  const sustainedMagnitude = orderedMagnitudes.length
    ? orderedMagnitudes[Math.floor(orderedMagnitudes.length / 2)]
    : 0;

  let consecutive = 0;
  for (let index = history.length - 1; index >= 0; index -= 1) {
    const value = history[index];
    if (Math.abs(value) < STRENGTH_SIGNIFICANT_DIFFERENCE) continue;
    if (Math.sign(value) !== dominantSign) break;
    consecutive += 1;
  }

  const continuation = Math.max(0, Math.min(1,
    consistency * 0.65 + Math.min(1, consecutive / Math.max(2, history.length * 0.5)) * 0.35,
  ));
  const currentAligned = Math.sign(current) === dominantSign || Math.abs(current) < STRENGTH_SIGNIFICANT_DIFFERENCE;

  if (!currentAligned && Math.abs(current) >= STRENGTH_SIGNIFICANT_DIFFERENCE * 2) {
    return current * 0.7;
  }

  const carriedMagnitude = sustainedMagnitude * (0.35 + continuation * 0.65);
  const liveMagnitude = Math.abs(current) * (0.55 + continuation * 0.45);
  return dominantSign * Math.max(liveMagnitude, carriedMagnitude);
}

function StrengthPentagon({ label, result, displayPairScores }: {
  label: number;
  result: ReturnType<typeof calculateCurrencyStrength>;
  displayPairScores: Record<string, number>;
}) {
  const centerX = 60;
  const centerY = 55;
  const radius = 35;
  const vertices = Object.fromEntries(STRENGTH_VERTEX_ORDER.map((currency, index) => {
    const angle = -Math.PI / 2 + index * (Math.PI * 2 / 5);
    return [currency, [centerX + Math.cos(angle) * radius, centerY + Math.sin(angle) * radius] as const];
  })) as Record<CurrencyCode, readonly [number, number]>;
  const outerPoints = STRENGTH_VERTEX_ORDER.map((currency) => vertices[currency].join(",")).join(" ");

  return <div className={`strength-pentagon ${result.ready ? "ready" : "waiting"}`}>
    <strong>{label}</strong>
    <svg viewBox="0 0 120 108" role="img" aria-label={`${label}点 通貨強弱${result.ready ? "" : " WAIT"}`}>
      <polygon className="strength-frame" points={outerPoints} />
      {STRENGTH_PAIR_CODES.map((pairCode) => {
        const [base, quote] = pairCode.split("/") as [CurrencyCode, CurrencyCode];
        return <line key={`guide-${pairCode}`} className="strength-guide-line" x1={vertices[base][0]} y1={vertices[base][1]} x2={vertices[quote][0]} y2={vertices[quote][1]} />;
      })}
      {result.ready && <defs>{STRENGTH_PAIR_CODES.map((pairCode, index) => {
        const [base, quote] = pairCode.split("/") as [CurrencyCode, CurrencyCode];
        const difference = displayPairScores[pairCode] ?? 0;
        const { color } = strengthVisual(difference);
        const neutralColor = [72, 76, 80] as const;
        const green = interpolateRgb(neutralColor, [20, 255, 138], color);
        const red = interpolateRgb(neutralColor, [255, 60, 92], color);
        const baseColor = difference >= 0 ? green : red;
        const quoteColor = difference >= 0 ? red : green;
        return <linearGradient key={pairCode} id={`strength-${label}-${index}`} gradientUnits="userSpaceOnUse" x1={vertices[base][0]} y1={vertices[base][1]} x2={vertices[quote][0]} y2={vertices[quote][1]}>
          <stop offset="0%" stopColor={baseColor} />
          <stop offset="46%" stopColor="#383b3d" />
          <stop offset="54%" stopColor="#383b3d" />
          <stop offset="100%" stopColor={quoteColor} />
        </linearGradient>;
      })}</defs>}
      {result.ready && STRENGTH_PAIR_CODES.map((pairCode, index) => {
        const [base, quote] = pairCode.split("/") as [CurrencyCode, CurrencyCode];
        const mapping = strengthVisual(displayPairScores[pairCode] ?? 0);
        return <line key={pairCode} className="strength-pair-line" data-pair={pairCode} x1={vertices[base][0]} y1={vertices[base][1]} x2={vertices[quote][0]} y2={vertices[quote][1]} stroke={`url(#strength-${label}-${index})`} strokeWidth={mapping.width} opacity={mapping.opacity} />;
      })}
      {STRENGTH_VERTEX_ORDER.map((currency, index) => {
        const angle = -Math.PI / 2 + index * (Math.PI * 2 / 5);
        return <text key={currency} x={centerX + Math.cos(angle) * 50} y={centerY + Math.sin(angle) * 50 + 3}>{currency}</text>;
      })}
      {!result.ready && <text className="pentagon-wait" x="60" y="58">WAIT</text>}
    </svg>
  </div>;
}

function calendarProximityClass(minutes: number) {
  if (minutes <= CALENDAR_RED_MINUTES && minutes >= -CALENDAR_POST_ALERT_MINUTES) return "proximity-red";
  if (minutes <= CALENDAR_ORANGE_MINUTES && minutes > CALENDAR_RED_MINUTES) return "proximity-orange";
  if (minutes <= CALENDAR_AMBER_MINUTES && minutes > CALENDAR_ORANGE_MINUTES) return "proximity-amber";
  return "proximity-normal";
}

function FlowDirection({ label, direction, history, requiredPoints }: {
  label: string;
  direction: Direction;
  history: Mode2PricePoint[];
  requiredPoints: number;
}) {
  if (history.length < requiredPoints) {
    return <span className="flow-direction pending" title={`${label}点 判定未成立`}>{label}<small>--</small></span>;
  }
  return <span className={`flow-direction ${direction} ${visualStrength(history)}`}>{label}{directionArrow(direction)}</span>;
}

function historyDisplayPriority(entry: CommentaryEntry) {
  if (entry.source === "COMMENTARY" && entry.level === "rapid") return 600;
  if (entry.importance === "NEWS_L3") return 500;
  if (entry.importance === "NEWS_L2") return 400;
  if (entry.level === "important") return 300;
  if (entry.source === "COMMENTARY") return 200;
  return 100;
}

function historyDisplayTtl(entry: CommentaryEntry) {
  if (entry.level === "rapid" || entry.importance === "NEWS_L3") return HISTORY_RAPID_TTL_MS;
  if (entry.level === "important" || entry.importance === "NEWS_L2") return HISTORY_IMPORTANT_TTL_MS;
  return HISTORY_NORMAL_TTL_MS;
}

function selectVisibleHistory(history: CommentaryEntry[], now: number) {
  return history
    .filter((entry) => now - entry.timestamp <= historyDisplayTtl(entry))
    .sort((left, right) => historyDisplayPriority(right) - historyDisplayPriority(left) || right.timestamp - left.timestamp)
    .slice(0, COMMENTARY_VISIBLE_LIMIT);
}

function Sparkline({ history, movement, direction }: {
  history: Mode2PricePoint[];
  movement: MovementState;
  direction: Direction;
}) {
  const displayedHistory = history.slice(-SPARKLINE_DISPLAY_POINT_COUNT);
  if (displayedHistory.length < 2) {
    return <div className="sparkline waiting"><span>履歴を蓄積中</span></div>;
  }
  const prices = displayedHistory.map((point) => point.price);
  const minimum = Math.min(...prices);
  const maximum = Math.max(...prices);
  const spread = maximum - minimum || Math.max(Math.abs(maximum) * 0.00001, 0.00001);
  const points = prices.map((price, index) => {
    const x = displayedHistory.length === 1 ? 50 : (index / (displayedHistory.length - 1)) * 100;
    const y = 26 - ((price - minimum) / spread) * 22;
    return `${x.toFixed(2)},${y.toFixed(2)}`;
  });
  const rapid = movement === "RAPID_UP" || movement === "RAPID_DOWN";
  const midDirection = visualDirection(displayedHistory.slice(-SPARKLINE_MID_WINDOW), direction);
  const recentDirection = visualDirection(displayedHistory.slice(-SPARKLINE_RECENT_WINDOW), midDirection);
  const midPoints = points.slice(-Math.min(SPARKLINE_MID_WINDOW, points.length)).join(" ");
  const recentPoints = points.slice(-Math.min(SPARKLINE_RECENT_WINDOW, points.length)).join(" ");
  const lastTwo = points.slice(-2).join(" ");
  return (
    <svg className={`sparkline ${direction} ${rapid ? "rapid" : ""}`} viewBox="0 0 100 30" preserveAspectRatio="none" aria-label={`直近${displayedHistory.length}点の値動き`}>
      <line className="spark-midline" x1="0" y1="15" x2="100" y2="15" />
      <polyline className="spark-path" points={points.join(" ")} />
      {displayedHistory.length > SPARKLINE_RECENT_WINDOW && <polyline className={`spark-mid-path ${midDirection}`} points={midPoints} />}
      {displayedHistory.length > 2 && <polyline className={`spark-recent-path ${recentDirection}`} points={recentPoints} />}
      {rapid && <polyline className="spark-rapid-segment" points={lastTwo} />}
    </svg>
  );
}

export default function Home() {
  const [selected, setSelected] = useState<string[]>(["USD/JPY"]);
  const selectedRef = useRef<string[]>(["USD/JPY"]);
  const [intervalSeconds, setIntervalSeconds] = useState(30);
  const [rates, setRates] = useState<RateMap>({});
  const [rateSources, setRateSources] = useState<Record<string, RateSource>>({});
  const [oandaStatus, setOandaStatus] = useState<"checking" | "connected" | "unconfigured" | "error" | "fallback">("checking");
  const [errors, setErrors] = useState<Record<string, boolean>>({});
  const [running, setRunning] = useState(false);
  const [soundOn, setSoundOn] = useState(true);
  const soundOnRef = useRef(true);
  const [audioMode, setAudioMode] = useState<AudioMode>("mode3");
  const audioModeRef = useRef<AudioMode>("mode3");
  const [commentaryHistory, setCommentaryHistory] = useState<CommentaryEntry[]>([]);
  const [newsStatus, setNewsStatus] = useState<"idle" | "receiving" | "error">("idle");
  const [calendarStatus, setCalendarStatus] = useState<"idle" | "receiving" | "error" | "stale">("idle");
  const [calendarEvents, setCalendarEvents] = useState<CalendarEvent[]>([]);
  const [rateDisplayStates, setRateDisplayStates] = useState<Record<string, RateDisplayState>>({});
  const [sparklineHistories, setSparklineHistories] = useState<Record<string, Mode2PricePoint[]>>({});
  const [volume, setVolume] = useState(80);
  const volumeRef = useRef(0.8);
  const speechRateRef = useRef(DEFAULT_SPEECH_RATE);
  const [status, setStatus] = useState("停止中");
  const [detail, setDetail] = useState("");
  const [remainingSeconds, setRemainingSeconds] = useState(AUTO_STOP_SECONDS);
  const [currentTime, setCurrentTime] = useState(() => Date.now());
  const [marketNotices, setMarketNotices] = useState<MarketNotice[]>(DEFAULT_MARKET_NOTICES);
  const [marketNoticeAdminOpen, setMarketNoticeAdminOpen] = useState(false);
  const [marketNoticesLoaded, setMarketNoticesLoaded] = useState(false);
  const [syntheticStatuses, setSyntheticStatuses] = useState<Record<string, SyntheticStatus>>({});
  const runningRef = useRef(false);
  const togglingRef = useRef(false);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const countdownRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const endAtRef = useRef(0);
  const runIdRef = useRef(0);
  const abortRef = useRef<AbortController | null>(null);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const audioContextRef = useRef<AudioContext | null>(null);
  const gainRef = useRef<GainNode | null>(null);
  const workerRef = useRef<Worker | null>(null);
  const nextRunAtRef = useRef(0);
  const previousAnalysisRatesRef = useRef<RateMap>({});
  const ratesRef = useRef<RateMap>({});
  const speechCacheRef = useRef(new Map<string, string>());
  const speechPendingRef = useRef(new Map<string, Promise<string>>());
  const activeSpeechCancelRef = useRef<(() => void) | null>(null);
  const audioQueueRef = useRef<Promise<void>>(Promise.resolve());
  const rateHistoryRef = useRef<Record<string, RatePoint[]>>({});
  const audioPriceHistoryRef = useRef<Record<string, Mode2PricePoint[]>>({});
  const sparklineHistoriesRef = useRef<Record<string, Mode2PricePoint[]>>({});
  const lastGraphGridRef = useRef<number | null>(null);
  const rapidDisplayRef = useRef<Record<string, { state: "RAPID_UP" | "RAPID_DOWN"; until: number }>>({});
  const movementTrackerRef = useRef<Record<string, MovementTracker>>({});
  const commentaryCooldownRef = useRef(new Map<string, number>());
  const volatilityRegimeRef = useRef<Record<string, "normal" | "expanded" | "quiet">>({});
  const lastSummaryAtRef = useRef(0);
  const newsTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const newsAbortRef = useRef<AbortController | null>(null);
  const seenNewsRef = useRef(new Set<string>());
  const newsSpeechActiveRef = useRef(false);
  const pendingNewsRef = useRef<NewsItem[]>([]);
  const pendingCommentaryRef = useRef<QueuedCommentary[]>([]);
  const latestMarketStatesRef = useRef<Array<{ name: string; state: MovementState; flow: FlowSnapshot }>>([]);
  const latestAcceptedRef = useRef<Record<string, boolean>>({});
  const calendarTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const calendarAbortRef = useRef<AbortController | null>(null);
  const calendarAlertedRef = useRef(new Set<string>());
  const graphFetchRef = useRef<AbortController | null>(null);
  const oandaShadowRef = useRef<Record<string, OandaShadowRecord[]>>({});
  const oandaEventSourceRef = useRef<EventSource | null>(null);
  const oandaLiveRef = useRef<RateMap>({});
  const yahooRatesRef = useRef<RateMap>({});
  const syntheticLearningRef = useRef<Record<string, SyntheticLearningState>>({});
  const rawSyntheticHistoryRef = useRef<Record<string, SyntheticPoint[]>>({});
  const syntheticOutputHistoryRef = useRef<Record<string, Rate[]>>({});
  const latestSyntheticRef = useRef<RateMap>({});
  const previousStrengthScoresRef = useRef<Partial<Record<number, CurrencyStrength>>>({});
  const strengthTrendHistoryRef = useRef<Record<number, Record<string, number[]>>>({});
  const [strengthDisplayScores, setStrengthDisplayScores] = useState<Record<number, Record<string, number>>>({});

  useEffect(() => {
    try {
      const saved = localStorage.getItem(MARKET_NOTICE_STORAGE_KEY);
      if (saved) {
        const parsed = JSON.parse(saved) as Array<Partial<MarketNotice>>;
        if (Array.isArray(parsed)) {
          setMarketNotices(parsed.filter((notice) => notice.id && notice.message && notice.start && notice.end).map((notice) => ({
            id: notice.id!,
            message: notice.message!,
            start: notice.start!,
            end: notice.end!,
            weekdays: Array.isArray(notice.weekdays) ? notice.weekdays : [...WEEKDAYS_ONLY],
            timeBasis: notice.timeBasis && notice.timeBasis in MARKET_NOTICE_TIME_ZONES ? notice.timeBasis : "fixed",
          })));
        }
      }
    } catch (error) {
      console.warn("FX Rate Speaker market notice restore failed", error);
    } finally {
      setMarketNoticesLoaded(true);
    }
  }, []);

  useEffect(() => {
    if (!marketNoticesLoaded) return;
    localStorage.setItem(MARKET_NOTICE_STORAGE_KEY, JSON.stringify(marketNotices));
  }, [marketNotices, marketNoticesLoaded]);

  function updateMarketNotice(id: string, changes: Partial<MarketNotice>) {
    setMarketNotices((current) => current.map((notice) => notice.id === id ? { ...notice, ...changes } : notice));
  }

  function changeMarketNoticeTimeBasis(notice: MarketNotice, timeBasis: MarketNoticeTimeBasis) {
    const startJst = marketNoticeJstTime(notice.timeBasis, notice.start, currentTime);
    const endJst = marketNoticeJstTime(notice.timeBasis, notice.end, currentTime);
    updateMarketNotice(notice.id, {
      timeBasis,
      start: marketNoticeSourceTime(timeBasis, startJst, currentTime),
      end: marketNoticeSourceTime(timeBasis, endJst, currentTime),
    });
  }

  function toggleMarketNoticeWeekday(id: string, weekday: number) {
    setMarketNotices((current) => current.map((notice) => {
      if (notice.id !== id) return notice;
      const weekdays = notice.weekdays.includes(weekday)
        ? notice.weekdays.filter((value) => value !== weekday)
        : [...notice.weekdays, weekday];
      return { ...notice, weekdays };
    }));
  }

  function addMarketNotice() {
    const id = `notice-${Date.now()}`;
    setMarketNotices((current) => [
      ...current,
      {
        id,
        message: "新しい注意事項",
        start: marketNoticeSourceTime("new_york", "12:00", currentTime),
        end: marketNoticeSourceTime("new_york", "12:30", currentTime),
        weekdays: [...WEEKDAYS_ONLY],
        timeBasis: "new_york",
      },
    ]);
  }

  function ensureAudio() {
    if (!audioRef.current) {
      const audio = new Audio();
      audio.preload = "auto";
      audio.defaultPlaybackRate = speechRateRef.current;
      audio.playbackRate = speechRateRef.current;
      audio.preservesPitch = true;
      audio.addEventListener("loadedmetadata", () => {
        audio.defaultPlaybackRate = speechRateRef.current;
        audio.playbackRate = speechRateRef.current;
      });
      const context = new AudioContext();
      const source = context.createMediaElementSource(audio);
      const gain = context.createGain();
      gain.gain.value = volumeRef.current;
      source.connect(gain).connect(context.destination);
      audioRef.current = audio;
      audioContextRef.current = context;
      gainRef.current = gain;
    }
    return audioRef.current;
  }

  function applyVolume(next: number) {
    const bounded = Math.round(Math.max(0, Math.min(100, next)));
    setVolume(bounded);
    volumeRef.current = bounded / 100;
    if (audioRef.current) audioRef.current.volume = volumeRef.current;
    if (gainRef.current && audioContextRef.current) {
      gainRef.current.gain.setValueAtTime(volumeRef.current, audioContextRef.current.currentTime);
    }
  }

  function applySoundEnabled(next: boolean) {
    soundOnRef.current = next;
    setSoundOn(next);
    if (!next) {
      activeSpeechCancelRef.current?.();
      audioRef.current?.pause();
      speechSynthesis.cancel();
    }
  }

  function applyAudioMode(next: AudioMode) {
    const leavingNews = audioModeRef.current === "mode4" && next !== "mode4";
    setAudioMode(next);
    audioModeRef.current = next;
    if (leavingNews) {
      if (newsTimerRef.current) window.clearTimeout(newsTimerRef.current);
      newsTimerRef.current = null;
      newsAbortRef.current?.abort();
      newsAbortRef.current = null;
      pendingNewsRef.current = [];
      pendingCommentaryRef.current = [];
      if (calendarTimerRef.current) window.clearTimeout(calendarTimerRef.current);
      calendarTimerRef.current = null;
      calendarAbortRef.current?.abort();
      calendarAbortRef.current = null;
      setCalendarStatus("idle");
      setNewsStatus("idle");
      if (newsSpeechActiveRef.current) {
        activeSpeechCancelRef.current?.();
        audioRef.current?.pause();
        newsSpeechActiveRef.current = false;
      }
    }
    try {
      window.localStorage.setItem(AUDIO_MODE_STORAGE_KEY, next);
    } catch {
      // The selected mode still works for this session when storage is unavailable.
    }
  }

  function wait(milliseconds: number) {
    return new Promise<void>((resolve) => window.setTimeout(resolve, milliseconds));
  }

  async function playStartChime(runId: number) {
    if (runId !== runIdRef.current || !soundOnRef.current) return;
    ensureAudio();
    const context = audioContextRef.current;
    const output = gainRef.current;
    if (!context || !output) return;
    await context.resume();
    const now = context.currentTime;
    const duration = 0.48;
    const frequencies = [620];
    const toneGain = context.createGain();
    toneGain.gain.setValueAtTime(0.0001, now);
    toneGain.gain.exponentialRampToValueAtTime(0.16, now + 0.025);
    toneGain.gain.exponentialRampToValueAtTime(0.0001, now + duration);
    toneGain.connect(output);
    frequencies.forEach((frequency) => {
      const oscillator = context.createOscillator();
      oscillator.type = "sine";
      oscillator.frequency.setValueAtTime(frequency, now);
      oscillator.connect(toneGain);
      oscillator.start(now);
      oscillator.stop(now + duration);
    });
    await wait(duration * 1000 + 110);
  }

  async function playCommentaryAlert(runId: number) {
    if (runId !== runIdRef.current || !soundOnRef.current) return;
    ensureAudio();
    const context = audioContextRef.current;
    const output = gainRef.current;
    if (!context || !output) return;
    await context.resume();
    const startAt = context.currentTime;
    [420, 720, 420, 900].forEach((frequency, index) => {
      const noteAt = startAt + index * 0.115;
      const oscillator = context.createOscillator();
      const toneGain = context.createGain();
      oscillator.type = "sawtooth";
      oscillator.frequency.setValueAtTime(frequency, noteAt);
      toneGain.gain.setValueAtTime(0.0001, noteAt);
      toneGain.gain.exponentialRampToValueAtTime(0.14, noteAt + 0.012);
      toneGain.gain.exponentialRampToValueAtTime(0.0001, noteAt + 0.085);
      oscillator.connect(toneGain).connect(output);
      oscillator.start(noteAt);
      oscillator.stop(noteAt + 0.09);
    });
    await wait(570);
  }

  async function playNewsAlert(level: NewsLevel, runId: number) {
    if (runId !== runIdRef.current || !soundOnRef.current) return;
    ensureAudio();
    const context = audioContextRef.current;
    const output = gainRef.current;
    if (!context || !output) return;
    await context.resume();
    const startAt = context.currentTime;
    const notes = level === "NEWS_L1"
      ? [{ frequency: 740, at: 0, duration: 0.15, gain: 0.1 }]
      : level === "NEWS_L2"
        ? [
          { frequency: 660, at: 0, duration: 0.16, gain: 0.12 },
          { frequency: 880, at: 0.18, duration: 0.34, gain: 0.13 },
        ]
        : [
          { frequency: 1040, at: 0, duration: 0.16, gain: 0.16 },
          { frequency: 720, at: 0.2, duration: 0.16, gain: 0.16 },
          { frequency: 1040, at: 0.4, duration: 0.48, gain: 0.16 },
        ];
    notes.forEach((note) => {
      const noteAt = startAt + note.at;
      const oscillator = context.createOscillator();
      const toneGain = context.createGain();
      oscillator.type = level === "NEWS_L3" ? "square" : "sine";
      oscillator.frequency.setValueAtTime(note.frequency, noteAt);
      toneGain.gain.setValueAtTime(0.0001, noteAt);
      toneGain.gain.exponentialRampToValueAtTime(note.gain, noteAt + 0.014);
      toneGain.gain.exponentialRampToValueAtTime(0.0001, noteAt + note.duration);
      oscillator.connect(toneGain).connect(output);
      oscillator.start(noteAt);
      oscillator.stop(noteAt + note.duration);
    });
    await wait(level === "NEWS_L1" ? 260 : level === "NEWS_L2" ? 650 : 1040);
  }

  async function playEventLeadSound(sound: LeadSound, runId: number) {
    // All event audio runs through the single queue. This value is also the
    // canonical ordering for future NEWS ingestion and queue arbitration.
    void AUDIO_EVENT_PRIORITY[sound];
    if (sound === "PRICE_RAPID") await playCommentaryAlert(runId);
    else if (sound !== "NONE") await playNewsAlert(sound, runId);
  }

  async function playCommentaryChime(runId: number) {
    if (runId !== runIdRef.current || !soundOnRef.current) return;
    ensureAudio();
    const context = audioContextRef.current;
    const output = gainRef.current;
    if (!context || !output) return;
    await context.resume();
    const now = context.currentTime;
    const oscillator = context.createOscillator();
    const toneGain = context.createGain();
    oscillator.type = "sine";
    oscillator.frequency.setValueAtTime(523.25, now);
    toneGain.gain.setValueAtTime(0.0001, now);
    toneGain.gain.exponentialRampToValueAtTime(0.14, now + 0.025);
    toneGain.gain.exponentialRampToValueAtTime(0.0001, now + 0.42);
    oscillator.connect(toneGain).connect(output);
    oscillator.start(now);
    oscillator.stop(now + 0.43);
    await wait(500);
  }

  async function playTimeSignal(runId: number) {
    if (runId !== runIdRef.current || !soundOnRef.current) return;
    ensureAudio();
    const context = audioContextRef.current;
    const output = gainRef.current;
    if (!context || !output) return;
    await context.resume();
    const startAt = context.currentTime;
    const phrases = [
      { at: 0, frequencies: [987.77, 1975.54], duration: 0.22 },
      { at: 0.28, frequencies: [659.25, 1318.5], duration: 0.78 },
    ];
    phrases.forEach((phrase) => {
      const noteAt = startAt + phrase.at;
      phrase.frequencies.forEach((frequency) => {
        [
          { ratio: 1, level: 0.055 },
          { ratio: 2.01, level: 0.012 },
        ].forEach((partial) => {
          const oscillator = context.createOscillator();
          const noteGain = context.createGain();
          oscillator.type = "sine";
          oscillator.frequency.setValueAtTime(frequency * partial.ratio, noteAt);
          noteGain.gain.setValueAtTime(0.0001, noteAt);
          noteGain.gain.exponentialRampToValueAtTime(partial.level, noteAt + 0.018);
          noteGain.gain.exponentialRampToValueAtTime(0.0001, noteAt + phrase.duration);
          oscillator.connect(noteGain).connect(output);
          oscillator.start(noteAt);
          oscillator.stop(noteAt + phrase.duration);
        });
      });
    });
    await wait(1180);
  }

  async function playDirectionTone(direction: Direction, runId: number) {
    if (runId !== runIdRef.current || !soundOnRef.current) return;
    ensureAudio();
    const context = audioContextRef.current;
    const output = gainRef.current;
    if (!context || !output) return;
    await context.resume();
    const frequencies = direction === "up"
      ? [610, 770, 970]
      : direction === "down"
        ? [970, 770, 610]
        : [770, 770, 770];
    // Three clearly separated notes so the direction cue is not buried by speech.
    const noteDuration = 0.13;
    const noteGap = 0.065;
    const startAt = context.currentTime;
    frequencies.forEach((frequency, index) => {
      const noteAt = startAt + index * (noteDuration + noteGap);
      const oscillator = context.createOscillator();
      const noteGain = context.createGain();
      oscillator.type = "triangle";
      oscillator.frequency.setValueAtTime(frequency, noteAt);
      noteGain.gain.setValueAtTime(0.0001, noteAt);
      noteGain.gain.exponentialRampToValueAtTime(0.22, noteAt + 0.012);
      noteGain.gain.exponentialRampToValueAtTime(0.0001, noteAt + noteDuration);
      oscillator.connect(noteGain).connect(output);
      oscillator.start(noteAt);
      oscillator.stop(noteAt + noteDuration);
    });
    await wait((frequencies.length * (noteDuration + noteGap)) * 1000 + 25);
  }

  async function playMovementTone(cue: MovementNotification, runId: number) {
    if (runId !== runIdRef.current || !soundOnRef.current) return;
    ensureAudio();
    const context = audioContextRef.current;
    const output = gainRef.current;
    if (!context || !output) return;
    await context.resume();
    const rapid = cue === "RAPID_UP" || cue === "RAPID_DOWN";
    const upward = cue === "UP_TREND" || cue === "RAPID_UP";
    // Every special cue starts with the familiar three-note direction motif.
    const frequencies = rapid
      ? (upward ? [610, 770, 970, 1190, 1480] : [970, 770, 610, 470, 350])
      : (upward ? [610, 770, 970, 1190] : [970, 770, 610, 470]);
    const noteGap = rapid ? 0.035 : 0.055;
    const startAt = context.currentTime;
    const filter = context.createBiquadFilter();
    filter.type = "lowpass";
    filter.frequency.setValueAtTime(rapid ? 2200 : 1800, startAt);
    filter.Q.setValueAtTime(0.8, startAt);
    filter.connect(output);
    frequencies.forEach((frequency, index) => {
      const noteDuration = rapid
        ? (index === frequencies.length - 1 ? 0.2 : 0.1)
        : (index === frequencies.length - 1 ? 0.28 : 0.13);
      const baseDuration = rapid ? 0.1 : 0.13;
      const noteAt = startAt + index * (baseDuration + noteGap);
      const oscillator = context.createOscillator();
      const noteGain = context.createGain();
      oscillator.type = "triangle";
      oscillator.frequency.setValueAtTime(frequency, noteAt);
      noteGain.gain.setValueAtTime(0.0001, noteAt);
      noteGain.gain.exponentialRampToValueAtTime(rapid ? 0.2 : 0.21, noteAt + 0.012);
      noteGain.gain.exponentialRampToValueAtTime(0.0001, noteAt + noteDuration);
      oscillator.connect(noteGain).connect(filter);
      oscillator.start(noteAt);
      oscillator.stop(noteAt + noteDuration);
    });
    const finalDuration = rapid ? 0.2 : 0.28;
    const baseDuration = rapid ? 0.1 : 0.13;
    await wait(((frequencies.length - 1) * (baseDuration + noteGap) + finalDuration) * 1000 + 55);
  }

  async function playMode2Tone(frequencies: number[], state: MovementState, runId: number) {
    if (runId !== runIdRef.current || !soundOnRef.current || frequencies.length !== MODE2_POINT_COUNT) return;
    ensureAudio();
    const context = audioContextRef.current;
    const output = gainRef.current;
    if (!context || !output) return;
    await context.resume();

    const noteDuration = 0.09;
    const noteStep = 0.13;
    const startAt = context.currentTime;
    frequencies.forEach((frequency, index) => {
      const noteAt = startAt + index * noteStep;
      const oscillator = context.createOscillator();
      const noteGain = context.createGain();
      oscillator.type = "sine";
      oscillator.frequency.setValueAtTime(frequency, noteAt);
      noteGain.gain.setValueAtTime(0.0001, noteAt);
      noteGain.gain.exponentialRampToValueAtTime(0.21, noteAt + 0.01);
      noteGain.gain.exponentialRampToValueAtTime(0.0001, noteAt + noteDuration);
      oscillator.connect(noteGain).connect(output);
      oscillator.start(noteAt);
      oscillator.stop(noteAt + noteDuration);
    });
    await wait(((frequencies.length - 1) * noteStep + noteDuration) * 1000 + 70);

    if (state === "NORMAL" || runId !== runIdRef.current || !soundOnRef.current) return;
    const rapid = state === "RAPID_UP" || state === "RAPID_DOWN";
    const upward = state === "UP_TREND" || state === "RAPID_UP";
    const supplement = rapid
      ? (upward ? [820, 1080, 1460] : [820, 560, 390])
      : (upward ? [820, 1080] : [820, 560]);
    const supplementStart = context.currentTime + 0.07;
    const supplementDuration = rapid ? 0.1 : 0.12;
    const supplementStep = rapid ? 0.12 : 0.15;
    supplement.forEach((frequency, index) => {
      const noteAt = supplementStart + index * supplementStep;
      const oscillator = context.createOscillator();
      const noteGain = context.createGain();
      oscillator.type = rapid ? "triangle" : "sine";
      oscillator.frequency.setValueAtTime(frequency, noteAt);
      noteGain.gain.setValueAtTime(0.0001, noteAt);
      noteGain.gain.exponentialRampToValueAtTime(rapid ? 0.2 : 0.15, noteAt + 0.01);
      noteGain.gain.exponentialRampToValueAtTime(0.0001, noteAt + supplementDuration);
      oscillator.connect(noteGain).connect(output);
      oscillator.start(noteAt);
      oscillator.stop(noteAt + supplementDuration);
    });
    await wait(70 + ((supplement.length - 1) * supplementStep + supplementDuration) * 1000 + 35);
  }

  async function playRateCue(cue: PlaybackCue, runId: number) {
    if (cue === "up" || cue === "down" || cue === "unchanged") {
      await playDirectionTone(cue, runId);
      return;
    }
    await playMovementTone(cue, runId);
  }

  function movementCue(code: string, rate: Rate, yen: boolean): MovementSnapshot {
    const currentHistory = rateHistoryRef.current[code] ?? [];
    const pipSize = yen ? 0.01 : 0.0001;
    const existingTracker = movementTrackerRef.current[code] ?? { state: "NORMAL", normalConfirmations: 0 };
    const appended = appendRatePoint(currentHistory, rate);
    if (!appended.accepted) {
      return {
        notification: null,
        state: "NORMAL",
        recentMove: recentMovePips(currentHistory, pipSize, 6),
        rapidMovePips: null,
      };
    }
    rateHistoryRef.current[code] = appended.history;
    const analysis = analyzeMovement(appended.history, pipSize);
    if (!analysis) {
      return {
        notification: null,
        state: existingTracker.state,
        recentMove: recentMovePips(appended.history, pipSize, 6),
        rapidMovePips: null,
      };
    }
    const transition = transitionMovement(existingTracker, analysis.candidate);
    movementTrackerRef.current[code] = transition.tracker;
    console.debug("[FX Rate Speaker movement]", {
      pair: code,
      state: transition.tracker.state,
      up: `${analysis.short.upCount}/${TREND_WINDOW}`,
      down: `${analysis.short.downCount}/${TREND_WINDOW}`,
      net5: `${analysis.short.netPips >= 0 ? "+" : ""}${analysis.short.netPips.toFixed(1)} pips`,
      net10: analysis.long
        ? `${analysis.long.netPips >= 0 ? "+" : ""}${analysis.long.netPips.toFixed(1)} pips`
        : "履歴不足",
      recentMove: `${analysis.thresholds.recentMove.toFixed(2)} pips`,
      recentRange: `${analysis.thresholds.recentRange.toFixed(2)} pips`,
      trendThreshold: `${analysis.thresholds.trend.toFixed(2)} pips`,
      rapid5: `${analysis.thresholds.rapidShort.toFixed(2)} pips`,
      rapid10: `${analysis.thresholds.rapidLong.toFixed(2)} pips`,
      volatilitySamples: `${analysis.thresholds.sampleCount}/${VOLATILITY_WINDOW}`,
      windows: `${RAPID_SHORT_WINDOW}/${RAPID_LONG_WINDOW}`,
    });
    const rapidMovePips = transition.notification === "RAPID_UP" || transition.notification === "RAPID_DOWN"
      ? Math.max(Math.abs(analysis.short.netPips), Math.abs(analysis.long.netPips))
      : null;
    return {
      notification: transition.notification,
      state: transition.tracker.state,
      recentMove: analysis.thresholds.recentMove,
      rapidMovePips,
    };
  }

  async function getSpeechUrl(text: string) {
    const cached = speechCacheRef.current.get(text);
    if (cached) return cached;
    const pending = speechPendingRef.current.get(text);
    if (pending) return pending;
    const request = fetch(`/api/tts?text=${encodeURIComponent(text)}`, { cache: "no-store" })
      .then(async (response) => {
        if (!response.ok) throw new Error("音声取得失敗");
        const url = URL.createObjectURL(await response.blob());
        speechCacheRef.current.set(text, url);
        if (speechCacheRef.current.size > 96) {
          const protectedNames = new Set<string>(PAIRS.map((pair) => pair.name));
          const oldest = [...speechCacheRef.current.keys()].find((key) => !protectedNames.has(key));
          if (oldest) {
            URL.revokeObjectURL(speechCacheRef.current.get(oldest)!);
            speechCacheRef.current.delete(oldest);
          }
        }
        return url;
      })
      .finally(() => speechPendingRef.current.delete(text));
    speechPendingRef.current.set(text, request);
    return request;
  }

  async function playSpeech(text: string, runId: number) {
    if (runId !== runIdRef.current || !soundOnRef.current) return;
    const speechUrl = await getSpeechUrl(text);
    if (runId !== runIdRef.current || !soundOnRef.current) return;
    const audio = ensureAudio();
    audio.pause();
    audio.currentTime = 0;
    audio.src = speechUrl;
    audio.defaultPlaybackRate = speechRateRef.current;
    audio.playbackRate = speechRateRef.current;
    await new Promise<void>((resolve, reject) => {
      const cleanup = () => {
        audio.removeEventListener("ended", onEnded);
        audio.removeEventListener("error", onError);
        if (activeSpeechCancelRef.current === onCancel) {
          activeSpeechCancelRef.current = null;
        }
      };
      const onEnded = () => { cleanup(); resolve(); };
      const onError = () => { cleanup(); reject(new Error("音声取得失敗")); };
      const onCancel = () => { cleanup(); resolve(); };
      activeSpeechCancelRef.current = onCancel;
      audio.addEventListener("ended", onEnded, { once: true });
      audio.addEventListener("error", onError, { once: true });
      audio.addEventListener("loadedmetadata", () => {
        audio.defaultPlaybackRate = speechRateRef.current;
        audio.playbackRate = speechRateRef.current;
      }, { once: true });
      void audioContextRef.current?.resume().then(() => {
        audio.defaultPlaybackRate = speechRateRef.current;
        audio.playbackRate = speechRateRef.current;
        return audio.play();
      }).catch(onError);
    });
  }

  function enqueueAudio(task: () => Promise<void>) {
    const next = audioQueueRef.current.catch(() => undefined).then(task);
    audioQueueRef.current = next.catch(() => undefined);
    return next;
  }

  function speakCurrentTime(runId: number, timestamp: number) {
    const current = new Date(timestamp);
    const text = `${current.getHours()}時${String(current.getMinutes()).padStart(2, "0")}分です`;
    void enqueueAudio(async () => {
      if (runId !== runIdRef.current || !soundOnRef.current) return;
      await getSpeechUrl(text);
      await playTimeSignal(runId);
      await wait(180);
      await playSpeech(text, runId);
    }).catch(() => {
      if (runId === runIdRef.current) {
        setDetail("時刻の音声を再生できませんでした。");
      }
    });
  }

  function relatedRapidPair(currencies: string[]) {
    return PAIRS.find((pair) => {
      if (!selected.includes(pair.code)) return false;
      const [base, quote] = pair.code.split("/");
      const state = movementTrackerRef.current[pair.code]?.state;
      return currencies.some((currency) => currency === base || currency === quote)
        && (state === "RAPID_UP" || state === "RAPID_DOWN");
    });
  }

  function newsSpeechText(item: NewsItem) {
    const rapidPair = relatedRapidPair(item.currencies);
    const prefix = item.level === "NEWS_L3" ? "速報です。" : "";
    const relation = rapidPair
      ? `同時刻付近で、${rapidPair.name}の値動きが拡大しています。`
      : "";
    return `${prefix}${item.summary}${relation}`;
  }

  function rememberNews(ids: string[]) {
    ids.forEach((id) => seenNewsRef.current.add(id));
    const retained = [...seenNewsRef.current].slice(-200);
    seenNewsRef.current = new Set(retained);
    try {
      window.localStorage.setItem(NEWS_SEEN_STORAGE_KEY, JSON.stringify(retained));
    } catch {
      // Session deduplication still works when persistent storage is unavailable.
    }
  }

  async function pollNews(runId: number) {
    if (runId !== runIdRef.current || !runningRef.current || audioModeRef.current !== "mode4") return;
    const controller = new AbortController();
    newsAbortRef.current = controller;
    try {
      setNewsStatus("receiving");
      const response = await fetch(`/api/news?t=${Date.now()}`, { cache: "no-store", signal: controller.signal });
      const data = await response.json() as NewsResponse;
      if (!response.ok) throw new Error(data.error || "NEWS取得失敗");
      if (runId !== runIdRef.current || audioModeRef.current !== "mode4") return;
      const unseen = (data.news ?? [])
        .filter((item) => !seenNewsRef.current.has(item.id))
        .sort((left, right) => left.publishedAt - right.publishedAt);
      rememberNews(unseen.map((item) => item.id));
      if (unseen.length) {
        const entries = unseen.map<CommentaryEntry>((item) => ({
          id: item.id,
          timestamp: item.publishedAt,
          source: "NEWS",
          pair: item.currencies.join("・") || "FX",
          kind: item.level.replace("NEWS_L", "NEWS "),
          text: item.summary,
          headline: item.title,
          url: item.url,
          level: item.level === "NEWS_L3" ? "rapid" : item.level === "NEWS_L2" ? "important" : "normal",
          currency: item.currencies.join("/"),
          importance: item.level,
        }));
        setCommentaryHistory((current) => [...entries.reverse(), ...current].slice(0, COMMENTARY_HISTORY_RETENTION_LIMIT));
        const spoken = unseen.filter((item) => item.level !== "NEWS_L1" && Date.now() - item.publishedAt <= 15 * 60 * 1000);
        pendingNewsRef.current = [...pendingNewsRef.current, ...spoken]
          .sort((left, right) => AUDIO_EVENT_PRIORITY[right.level] - AUDIO_EVENT_PRIORITY[left.level])
          .slice(0, 8);
      }
      setNewsStatus("receiving");
    } catch (error) {
      if (!controller.signal.aborted && runId === runIdRef.current && audioModeRef.current === "mode4") {
        console.warn("FX Rate Speaker NEWS fetch failed", error);
        setNewsStatus("error");
      }
    } finally {
      if (newsAbortRef.current === controller) newsAbortRef.current = null;
      if (runId === runIdRef.current && runningRef.current && audioModeRef.current === "mode4") {
        newsTimerRef.current = window.setTimeout(() => { void pollNews(runId); }, NEWS_POLL_INTERVAL_MS);
      }
    }
  }

  function calendarSpeech(event: CalendarEvent, stage: "30" | "5" | "result") {
    const name = event.title;
    if (stage === "30") return `30分後に${name}です。`;
    if (stage === "5") return `5分後に${name}です。${event.currency}関連の急変に注意してください。`;
    const values = [event.actual && `結果${event.actual}`, event.forecast && `予想${event.forecast}`, event.previous && `前回${event.previous}`].filter(Boolean).join("、");
    return `${name}が発表されました。${values}。`;
  }

  async function pollCalendar() {
    const controller = new AbortController();
    calendarAbortRef.current?.abort();
    calendarAbortRef.current = controller;
    try {
      const response = await fetch(`/api/calendar?t=${Date.now()}`, { cache: "no-store", signal: controller.signal });
      const data = await response.json() as CalendarResponse;
      if (!response.ok || !data.events) throw new Error(data.error || "指標取得失敗");
      const fetchedAt = data.fetchedAt ?? 0;
      if (Date.now() - fetchedAt > CALENDAR_STALE_MS) {
        setCalendarStatus("stale");
        return;
      }
      const now = Date.now();
      setCalendarEvents(data.events.filter((event) => now - event.scheduledAt <= CALENDAR_POST_EVENT_MS));
      setCalendarStatus("receiving");

      if (runningRef.current && audioModeRef.current === "mode4") {
        const newEntries: QueuedCommentary[] = [];
        data.events.forEach((event) => {
          const minutes = (event.scheduledAt - now) / 60_000;
          const stage: "30" | "5" | "result" | null = event.actual && minutes <= 0 && minutes >= -20
            ? "result" : minutes > 0 && minutes <= 5 ? "5" : minutes > 5 && minutes <= 30 ? "30" : null;
          if (!stage) return;
          const alertKey = `${event.id}:${stage}`;
          if (calendarAlertedRef.current.has(alertKey)) return;
          calendarAlertedRef.current.add(alertKey);
          const timestamp = Date.now();
          const entry: QueuedCommentary = {
            id: alertKey,
            timestamp,
            source: "COMMENTARY",
            pair: event.currency,
            kind: stage === "result" ? `指標 ${event.level}` : `指標${stage}分前`,
            text: calendarSpeech(event, stage),
            level: event.level === "L3" || stage === "result" ? "important" : "normal",
            priority: event.level === "L3" ? 48 : 38,
          };
          newEntries.push(entry);
        });
        if (newEntries.length) {
          pendingCommentaryRef.current = [...pendingCommentaryRef.current, ...newEntries]
            .sort((left, right) => right.priority - left.priority || right.timestamp - left.timestamp).slice(0, 8);
          setCommentaryHistory((current) => [...newEntries.reverse(), ...current].slice(0, COMMENTARY_HISTORY_RETENTION_LIMIT));
        }
      }
    } catch (error) {
      if (!controller.signal.aborted) {
        console.warn("FX Rate Speaker calendar fetch failed", error);
        setCalendarStatus("error");
      }
    } finally {
      if (calendarAbortRef.current === controller) calendarAbortRef.current = null;
      calendarTimerRef.current = window.setTimeout(() => { void pollCalendar(); }, CALENDAR_POLL_INTERVAL_MS);
    }
  }

  useEffect(() => {
    if (!running || audioMode !== "mode4") return;
    const runId = runIdRef.current;
    void pollNews(runId);
    return () => {
      if (newsTimerRef.current) window.clearTimeout(newsTimerRef.current);
      newsTimerRef.current = null;
      newsAbortRef.current?.abort();
      newsAbortRef.current = null;
    };
  }, [running, audioMode]);

  useEffect(() => {
    void pollCalendar();
    return () => {
      if (calendarTimerRef.current) window.clearTimeout(calendarTimerRef.current);
      calendarTimerRef.current = null;
      calendarAbortRef.current?.abort();
      calendarAbortRef.current = null;
    };
  }, []);

  useEffect(() => {
    const restoreTimer = window.setTimeout(() => {
      try {
        const saved = window.localStorage.getItem(AUDIO_MODE_STORAGE_KEY);
        const restored: AudioMode = saved === "mode2" || saved === "mode4" ? saved : "mode3";
        setAudioMode(restored);
        audioModeRef.current = restored;
        const seen = JSON.parse(window.localStorage.getItem(NEWS_SEEN_STORAGE_KEY) ?? "[]") as string[];
        seenNewsRef.current = new Set(seen.slice(-200));
        const shadow = JSON.parse(window.localStorage.getItem(OANDA_SHADOW_STORAGE_KEY) ?? "[]") as OandaShadowRecord[];
        oandaShadowRef.current = shadow.reduce<Record<string, OandaShadowRecord[]>>((grouped, record) => {
          grouped[record.symbol] = [...(grouped[record.symbol] ?? []), record].slice(-2000);
          return grouped;
        }, {});
        const savedSynthetic = JSON.parse(window.localStorage.getItem(SYNTHETIC_STORAGE_KEY) ?? "{}") as Record<string, SyntheticLearningState>;
        syntheticLearningRef.current = Object.fromEntries(SYNTHETIC_SYMBOLS.map((symbol) => {
          const saved = savedSynthetic[symbol];
          return [symbol, saved && Array.isArray(saved.errors) ? saved : emptySyntheticLearningState()];
        }));
        setSyntheticStatuses(Object.fromEntries(SYNTHETIC_SYMBOLS.map((symbol) => [symbol, syntheticLearningRef.current[symbol].status])));
      } catch {
        // Keep mode 3 as the default when storage is unavailable.
      }
    }, 0);
    return () => window.clearTimeout(restoreTimer);
  }, []);

  useEffect(() => {
    const update = () => setCurrentTime(Date.now());
    update();
    const timer = window.setInterval(update, 1000);
    return () => window.clearInterval(timer);
  }, []);

  useEffect(() => {
    return () => {
      runIdRef.current += 1;
      if (timerRef.current) clearTimeout(timerRef.current);
      if (countdownRef.current) clearInterval(countdownRef.current);
      abortRef.current?.abort();
      newsAbortRef.current?.abort();
      if (newsTimerRef.current) clearTimeout(newsTimerRef.current);
      calendarAbortRef.current?.abort();
      if (calendarTimerRef.current) clearTimeout(calendarTimerRef.current);
      graphFetchRef.current?.abort();
      oandaEventSourceRef.current?.close();
      audioRef.current?.pause();
      workerRef.current?.terminate();
      speechCacheRef.current.forEach((url) => URL.revokeObjectURL(url));
      speechCacheRef.current.clear();
      void audioContextRef.current?.close();
    };
  }, []);

  function stop(autoStopped = false) {
    runningRef.current = false;
    runIdRef.current += 1;
    if (timerRef.current) clearTimeout(timerRef.current);
    timerRef.current = null;
    if (countdownRef.current) clearInterval(countdownRef.current);
    countdownRef.current = null;
    if (newsTimerRef.current) clearTimeout(newsTimerRef.current);
    newsTimerRef.current = null;
    newsAbortRef.current?.abort();
    newsAbortRef.current = null;
    newsSpeechActiveRef.current = false;
    pendingNewsRef.current = [];
    pendingCommentaryRef.current = [];
    graphFetchRef.current?.abort();
    graphFetchRef.current = null;
    oandaEventSourceRef.current?.close();
    oandaEventSourceRef.current = null;
    persistOandaShadow();
    abortRef.current?.abort();
    workerRef.current?.postMessage({ type: "stop" });
    activeSpeechCancelRef.current?.();
    if (audioRef.current) {
      audioRef.current.pause();
      audioRef.current.currentTime = 0;
    }
    setRunning(false);
    setStatus(autoStopped ? "3時間経過・自動停止" : "停止中");
    setDetail("");
    setRemainingSeconds(autoStopped ? 0 : AUTO_STOP_SECONDS);
  }

  function resetSessionAnalysisHistory() {
    rateHistoryRef.current = {};
    audioPriceHistoryRef.current = {};
    sparklineHistoriesRef.current = {};
    previousAnalysisRatesRef.current = {};
    movementTrackerRef.current = {};
    volatilityRegimeRef.current = {};
    latestAcceptedRef.current = {};
    latestMarketStatesRef.current = [];
    rapidDisplayRef.current = {};
    lastGraphGridRef.current = null;
    previousStrengthScoresRef.current = {};
    strengthTrendHistoryRef.current = {};
    commentaryCooldownRef.current.clear();
    pendingCommentaryRef.current = [];
    setSparklineHistories({});
    setRateDisplayStates({});
    setStrengthDisplayScores({});
    setCommentaryHistory([]);
  }

  function commentaryCandidate(
    code: string,
    name: string,
    movement: MovementSnapshot,
    history: RatePoint[],
    pipSize: number,
    accepted: boolean,
    sparkHistory: Mode2PricePoint[],
  ): CommentaryCandidate | null {
    if (!accepted || history.length < 2) return null;
    const flow = flowSnapshot(sparkHistory);
    if (movement.notification === "RAPID_UP" || movement.notification === "RAPID_DOWN") {
      return {
        pair: code,
        kind: "急変",
        text: `急変です。${name}、直近約${(movement.rapidMovePips ?? 0).toFixed(1)}pips動いています。 ${flowCommentary(name, flow, movement.state)}`,
        level: "rapid",
        eventKey: movement.notification,
        priority: 100,
        cooldownMs: RAPID_COMMENTARY_COOLDOWN_MS,
      };
    }
    const current = history.at(-1)!.price;
    const breakout = breakoutCandidate(sparkHistory, pipSize);
    if (breakout) {
      const clear = breakout.widthPips >= breakout.requiredPips;
      console.debug("[FX Rate Speaker breakout]", {
        pair: code,
        comparisonPeriod: "約15分",
        samples: breakout.samples,
        reference: breakout.reference,
        current,
        updatePips: Number(breakout.widthPips.toFixed(2)),
        requiredPips: Number(breakout.requiredPips.toFixed(2)),
        result: clear ? "実況候補" : "軽微更新のため抑制",
      });
      if (clear) {
        const high = breakout.side === "high";
        return {
          pair: code,
          kind: high ? "高値更新" : "安値更新",
          text: flowCommentary(name, flow, movement.state, breakout.side),
          level: "important",
          eventKey: high ? "HIGH_BREAK" : "LOW_BREAK",
          priority: 70,
          cooldownMs: BREAKOUT_COOLDOWN_MS,
        };
      }
    }

    if (movement.notification === "UP_TREND" || movement.notification === "DOWN_TREND") {
      const rising = movement.notification === "UP_TREND";
      return {
        pair: code,
        kind: rising ? "上昇傾向" : "下落傾向",
        text: flowCommentary(name, flow, movement.state),
        level: "important",
        eventKey: movement.notification,
        priority: 60,
      };
    }

    if (movement.recentMove !== null) {
      const previous = history.at(-2)!.price;
      const latestMove = Math.abs(current - previous) / pipSize;
      const nextRegime = latestMove >= movement.recentMove * 2
        ? "expanded"
        : latestMove <= movement.recentMove * 0.3
          ? "quiet"
          : "normal";
      const oldRegime = volatilityRegimeRef.current[code] ?? "normal";
      volatilityRegimeRef.current[code] = nextRegime;
      if (nextRegime !== oldRegime && nextRegime === "expanded") {
        return {
          pair: code,
          kind: "値幅拡大",
          text: `${flowCommentary(name, flow, movement.state)} 値幅も拡大しています。`,
          level: "important",
          eventKey: "VOL_EXPANDED",
          priority: 40,
        };
      }
      if (nextRegime !== oldRegime && nextRegime === "quiet") {
        return {
          pair: code,
          kind: "値動き鈍化",
          text: `${flowCommentary(name, flow, movement.state)} 値動きは鈍化しています。`,
          level: "normal",
          eventKey: "VOL_QUIET",
          priority: 30,
        };
      }
    }
    return null;
  }

  function chooseCommentary(
    candidates: CommentaryCandidate[],
    states: Array<{ name: string; state: MovementState; flow: FlowSnapshot }>,
    now: number,
  ): CommentaryEntry | null {
    const candidate = [...candidates]
      .sort((left, right) => right.priority - left.priority)
      .find((item) => {
        const key = `${item.pair}:${item.eventKey}`;
        const lastAt = commentaryCooldownRef.current.get(key) ?? 0;
        return now - lastAt >= (item.cooldownMs ?? COMMENTARY_COOLDOWN_MS);
      });
    if (candidate) {
      commentaryCooldownRef.current.set(`${candidate.pair}:${candidate.eventKey}`, now);
      return {
        id: `${now}-${candidate.pair}-${candidate.eventKey}`,
        timestamp: now,
        source: "COMMENTARY",
        pair: candidate.pair,
        kind: candidate.kind,
        text: candidate.text,
        level: candidate.level,
      };
    }
    if (now - lastSummaryAtRef.current < SUMMARY_INTERVAL_MS) return null;
    lastSummaryAtRef.current = now;
    const active = states
      .filter((item) => item.state !== "NORMAL" || item.flow.overall !== "unchanged" || item.flow.recent !== "unchanged")
      .slice(0, 2);
    const text = active.length
      ? `現在の市場です。${active.map((item) => flowCommentary(item.name, item.flow, item.state)).join(" ")}`
      : "現在の市場です。10ペア全体に、明確な傾向や急変は出ていません。";
    return {
      id: `${now}-summary`,
      timestamp: now,
      source: "COMMENTARY",
      pair: "市場全体",
      kind: "定期実況",
      text,
      level: "normal",
    };
  }

  function addCommentaryHistory(entry: CommentaryEntry) {
    setCommentaryHistory((current) => {
      if (entry.source !== "COMMENTARY") return [entry, ...current].slice(0, COMMENTARY_HISTORY_RETENTION_LIMIT);
      const index = current.findIndex((item) => item.source === "COMMENTARY"
        && item.pair === entry.pair
        && Math.abs(entry.timestamp - item.timestamp) <= COMMENTARY_MERGE_MS);
      if (index < 0) return [entry, ...current].slice(0, COMMENTARY_HISTORY_RETENTION_LIMIT);
      const prior = current[index];
      const kinds = [...new Set([prior.kind, entry.kind].flatMap((kind) => kind.split("・")))];
      if (kinds.includes("急変")) kinds.splice(0, kinds.length, "急変", ...kinds.filter((kind) => kind !== "急変"));
      const merged: CommentaryEntry = {
        ...prior,
        ...entry,
        id: `${entry.id}-merged`,
        kind: kinds.join("・"),
        level: prior.level === "rapid" || entry.level === "rapid" ? "rapid"
          : prior.level === "important" || entry.level === "important" ? "important" : "normal",
        text: entry.level === "rapid" ? entry.text : prior.level === "rapid" ? prior.text : entry.text,
      };
      return [merged, ...current.filter((_, itemIndex) => itemIndex !== index)].slice(0, COMMENTARY_HISTORY_RETENTION_LIMIT);
    });
  }

  function extendRapidDisplayForAudio(pair: string) {
    const rapid = rapidDisplayRef.current[pair];
    if (!rapid) return;
    const now = Date.now();
    if (rapid.until - now < RAPID_AUDIO_MIN_REMAINING_MS) rapid.until = now + RAPID_AUDIO_MIN_REMAINING_MS;
    setRateDisplayStates((current) => ({
      ...current,
      [pair]: { direction: rapid.state === "RAPID_UP" ? "up" : "down", movement: rapid.state },
    }));
  }

  function persistSyntheticLearning() {
    try {
      window.localStorage.setItem(SYNTHETIC_STORAGE_KEY, JSON.stringify(syntheticLearningRef.current));
    } catch {
      // Current-session learning continues if persistent storage is unavailable.
    }
  }

  function processSyntheticSnapshot(freshRates: RateMap, sources: RateMap | undefined, actuals?: RateMap) {
    if (!sources) return {} as RateMap;
    const now = Date.now();
    const output: RateMap = {};
    const statuses: Record<string, SyntheticStatus> = {};
    SYNTHETIC_SYMBOLS.forEach((symbol) => {
      const state = syntheticLearningRef.current[symbol] ?? emptySyntheticLearningState();
      const rawPoint = rawSyntheticFor(symbol, sources, now);
      if (!rawPoint) {
        // Do not keep reusing an old synthetic point after its source timestamps stop aligning.
        // Falling back to the formal direct rate prevents a flat/stale graph until synthetic recovers.
        delete latestSyntheticRef.current[symbol];
        statuses[symbol] = state.status;
        return;
      }
      const correctedBeforeLearning = applyCurrentCorrection(rawPoint, state);
      const outputHistory = syntheticOutputHistoryRef.current[symbol] ?? [];
      if (!isSyntheticJumpValid(outputHistory, correctedBeforeLearning.correctedSynthetic)) {
        console.warn("[FX Rate Speaker Synthetic] abnormal jump rejected", { symbol, rawPoint, state: state.status });
        statuses[symbol] = state.status;
        return;
      }
      const rawHistory = [...(rawSyntheticHistoryRef.current[symbol] ?? []), rawPoint].slice(-140);
      rawSyntheticHistoryRef.current[symbol] = rawHistory;
      const syntheticRate = { price: correctedBeforeLearning.correctedSynthetic, timestamp: correctedBeforeLearning.timestamp };
      output[symbol] = syntheticRate;
      latestSyntheticRef.current[symbol] = syntheticRate;
      syntheticOutputHistoryRef.current[symbol] = [...outputHistory, syntheticRate].slice(-140);

      const yahoo = actuals?.[symbol] ?? freshRates[symbol];
      if (!yahoo) {
        syntheticLearningRef.current[symbol] = state;
        statuses[symbol] = state.status;
        return;
      }
      const learned = learnFromYahoo(state, yahoo, rawHistory);
      syntheticLearningRef.current[symbol] = learned.state;
      statuses[symbol] = learned.state.status;
      if (learned.warning) console.warn("[FX Rate Speaker Synthetic]", symbol, learned.warning);
      if (learned.accepted && learned.sample) {
        const nextCorrection = learned.state.activeMedianError;
        console.debug("[FX Rate Speaker Synthetic audit]", {
          symbol,
          yahooActual: yahoo.price,
          rawSynthetic: rawPoint.rawSynthetic,
          correctedSynthetic: correctedBeforeLearning.correctedSynthetic,
          rawErrorPips: learned.sample.rawErrorPips,
          correctedErrorPips: learned.sample.correctedErrorPips,
          currentMedianCorrectionPips: nextCorrection / 0.0001,
          sampleCount: learned.state.stats.sampleCount,
          sourceTimestamps: rawPoint.sourceTimestamps,
          yahooTimestamp: yahoo.timestamp,
          status: learned.state.status,
          syntheticEnabled: learned.state.useCorrected,
          rawMaePips: learned.state.stats.rawMaePips,
          correctedMaePips: learned.state.stats.correctedMaePips,
          rawP95Pips: learned.state.stats.rawP95Pips,
          correctedP95Pips: learned.state.stats.correctedP95Pips,
        });
        persistSyntheticLearning();
      }
    });
    setSyntheticStatuses(statuses);
    return output;
  }

  function freshOandaRate(code: string, now = Date.now()) {
    const rate = oandaLiveRef.current[code];
    if (!rate) return null;
    const age = now - rate.timestamp * 1000;
    return age >= -20_000 && age <= OANDA_PRIMARY_STALE_MS ? rate : null;
  }

  function syntheticOandaRate(code: string, now = Date.now()): Rate | null {
    const direct = (symbol: string) => freshOandaRate(symbol, now);
    const cross = (left: Rate | null, right: Rate | null, operation: "multiply" | "divide") => {
      if (!left || !right || (operation === "divide" && right.price === 0)) return null;
      const price = operation === "multiply" ? left.price * right.price : left.price / right.price;
      return Number.isFinite(price) && price > 0
        ? { price, timestamp: Math.min(left.timestamp, right.timestamp) }
        : null;
    };
    if (code === "EUR/USD") return cross(direct("EUR/JPY"), direct("USD/JPY"), "divide");
    if (code === "GBP/USD") return cross(direct("GBP/JPY"), direct("USD/JPY"), "divide");
    if (code === "AUD/USD") return cross(direct("AUD/JPY"), direct("USD/JPY"), "divide");
    if (code === "EUR/JPY") return cross(direct("EUR/USD"), direct("USD/JPY"), "multiply");
    if (code === "GBP/JPY") return cross(direct("GBP/USD"), direct("USD/JPY"), "multiply");
    if (code === "AUD/JPY") return cross(direct("AUD/USD"), direct("USD/JPY"), "multiply");
    if (code === "EUR/GBP") return cross(direct("EUR/USD"), direct("GBP/USD"), "divide");
    if (code === "EUR/AUD") return cross(direct("EUR/USD"), direct("AUD/USD"), "divide");
    if (code === "GBP/AUD") return cross(direct("GBP/USD"), direct("AUD/USD"), "divide");
    if (code === "USD/JPY") {
      return cross(direct("EUR/JPY"), direct("EUR/USD"), "divide")
        ?? cross(direct("GBP/JPY"), direct("GBP/USD"), "divide");
    }
    return null;
  }

  function applyAdoptedRates(yahooRates: RateMap) {
    const now = Date.now();
    const adopted: RateMap = {};
    const sources: Record<string, RateSource> = {};
    PAIRS.forEach((pair) => {
      const direct = freshOandaRate(pair.code, now);
      if (direct) {
        adopted[pair.code] = direct;
        sources[pair.code] = "OANDA";
        return;
      }
      const synthetic = syntheticOandaRate(pair.code, now);
      if (synthetic) {
        adopted[pair.code] = synthetic;
        sources[pair.code] = "OANDA_SYNTHETIC";
        return;
      }
      const yahoo = yahooRates[pair.code];
      if (yahoo) {
        adopted[pair.code] = yahoo;
        sources[pair.code] = "YAHOO";
      }
    });
    ratesRef.current = adopted;
    setRates(adopted);
    setRateSources(sources);
    return adopted;
  }

  function updateRateSnapshot(freshRates: RateMap, syntheticSources?: RateMap, syntheticActuals?: RateMap) {
    yahooRatesRef.current = { ...yahooRatesRef.current, ...freshRates };
    processSyntheticSnapshot(freshRates, syntheticSources, syntheticActuals);
    return applyAdoptedRates(yahooRatesRef.current);
  }

  function auditSlowDirectRates(freshRates: RateMap, syntheticActuals: RateMap | undefined, fetchedAt?: number) {
    const now = Date.now();
    (["EUR/USD", "GBP/USD", "EUR/GBP"] as const).forEach((symbol) => {
      const yahooDirect = syntheticActuals?.[symbol] ?? freshRates[symbol];
      const rawPoint = rawSyntheticHistoryRef.current[symbol]?.at(-1);
      const corrected = latestSyntheticRef.current[symbol];
      const card = ratesRef.current[symbol];
      const graph = sparklineHistoriesRef.current[symbol]?.at(-1);
      const ageSeconds = (timestamp?: number) => timestamp
        ? Number(((now - timestamp * 1000) / 1000).toFixed(1))
        : null;
      console.debug("[FX Rate Speaker rate source audit]", {
        symbol,
        yahooDirectPrice: yahooDirect?.price ?? null,
        yahooTimestamp: yahooDirect?.timestamp ?? null,
        yahooAgeSeconds: ageSeconds(yahooDirect?.timestamp),
        rawSynthetic: rawPoint?.rawSynthetic ?? null,
        correctedSynthetic: corrected?.price ?? null,
        syntheticTimestamp: corrected?.timestamp ?? rawPoint?.timestamp ?? null,
        syntheticAgeSeconds: ageSeconds(corrected?.timestamp ?? rawPoint?.timestamp),
        cardDisplayedPrice: card?.price ?? null,
        cardTimestamp: card?.timestamp ?? null,
        graphUsedPrice: graph?.price ?? null,
        graphTimestamp: graph?.timestamp ?? null,
        apiFetchedAt: fetchedAt ?? null,
        receivedAt: Math.floor(now / 1000),
      });
    });
  }

  function recordGraphGridPoint(now = Date.now()) {
    const gridTimestamp = Math.floor(now / GRAPH_RATE_POLL_MS) * (GRAPH_RATE_POLL_MS / 1000);
    if (lastGraphGridRef.current === gridTimestamp) return sparklineHistoriesRef.current;
    lastGraphGridRef.current = gridTimestamp;
    const nextSparklineHistories = { ...sparklineHistoriesRef.current };
    PAIRS.forEach((pair) => {
      const latest = ratesRef.current[pair.code];
      if (!latest || !Number.isFinite(latest.price) || latest.price <= 0) return;
      nextSparklineHistories[pair.code] = appendSparklinePoint(nextSparklineHistories[pair.code] ?? [], {
        price: latest.price,
        timestamp: gridTimestamp,
      });
    });
    sparklineHistoriesRef.current = nextSparklineHistories;
    setSparklineHistories(nextSparklineHistories);
    return nextSparklineHistories;
  }

  function analyzeAllPairs(freshRates: RateMap, histories: Record<string, Mode2PricePoint[]>) {
    const candidates: CommentaryCandidate[] = [];
    const states: Array<{ name: string; state: MovementState; flow: FlowSnapshot }> = [];
    const displayUpdates: Record<string, RateDisplayState> = {};
    const now = Date.now();
    PAIRS.forEach((pair) => {
      const analysisRate = freshRates[pair.code];
      if (!analysisRate) return;
      const previous = previousAnalysisRatesRef.current[pair.code]?.price;
      const direction: Direction = previous !== undefined && analysisRate.price > previous
        ? "up" : previous !== undefined && analysisRate.price < previous ? "down" : "unchanged";
      const movement = movementCue(pair.code, analysisRate, pair.yen);
      const audioUpdate = appendMode2PricePoint(audioPriceHistoryRef.current[pair.code] ?? [], analysisRate);
      audioPriceHistoryRef.current[pair.code] = audioUpdate.history;
      if (audioUpdate.accepted) latestAcceptedRef.current[pair.code] = true;
      const history = histories[pair.code] ?? [];
      const flow = flowSnapshot(history, direction);
      const candidate = commentaryCandidate(
        pair.code,
        pair.name,
        movement,
        rateHistoryRef.current[pair.code] ?? [],
        pair.yen ? 0.01 : 0.0001,
        audioUpdate.accepted,
        history,
      );
      if (candidate) candidates.push(candidate);
      states.push({ name: pair.name, state: movement.state, flow });
      if (movement.state === "RAPID_UP" || movement.state === "RAPID_DOWN") {
        rapidDisplayRef.current[pair.code] = { state: movement.state, until: now + RAPID_DISPLAY_HOLD_MS };
      }
      const heldRapid = rapidDisplayRef.current[pair.code];
      const displayMovement = heldRapid && heldRapid.until > now ? heldRapid.state : movement.state;
      if (heldRapid && heldRapid.until <= now) delete rapidDisplayRef.current[pair.code];
      displayUpdates[pair.code] = { direction, movement: displayMovement };
      previousAnalysisRatesRef.current[pair.code] = analysisRate;
    });
    const currencyMoves = new Map<string, number[]>();
    candidates.forEach((candidate) => {
      const direction = /UP/.test(candidate.eventKey) ? 1 : /DOWN/.test(candidate.eventKey) ? -1 : 0;
      if (!direction) return;
      const [base, quote] = candidate.pair.split("/");
      currencyMoves.set(base, [...(currencyMoves.get(base) ?? []), direction]);
      currencyMoves.set(quote, [...(currencyMoves.get(quote) ?? []), -direction]);
    });
    for (const [currency, moves] of currencyMoves) {
      const score = moves.reduce((sum, value) => sum + value, 0);
      if (moves.length < 2 || Math.abs(score) < 2) continue;
      candidates.push({
        pair: currency,
        kind: "複数ペア",
        text: `${currency === "AUD" ? "豪ドル" : currency}が複数ペアで${score > 0 ? "強く" : "弱く"}なっています。`,
        level: "important",
        eventKey: `CURRENCY_${score > 0 ? "UP" : "DOWN"}`,
        priority: 75,
      });
    }
    latestMarketStatesRef.current = states;
    setRateDisplayStates((current) => ({ ...current, ...displayUpdates }));
    if (audioModeRef.current !== "mode3" && audioModeRef.current !== "mode4") return;
    const selectedCommentary = chooseCommentary(candidates, states, Date.now());
    if (!selectedCommentary) return;
    const priority = candidates.find((candidate) =>
      selectedCommentary.id.includes(candidate.eventKey) && selectedCommentary.pair === candidate.pair,
    )?.priority ?? 20;
    pendingCommentaryRef.current = [
      ...pendingCommentaryRef.current,
      { ...selectedCommentary, priority },
    ].sort((left, right) => right.priority - left.priority || right.timestamp - left.timestamp).slice(0, 6);
    addCommentaryHistory(selectedCommentary);
  }

  async function refreshGraphRates(runId: number) {
    if (runId !== runIdRef.current || !runningRef.current || graphFetchRef.current) return;
    const controller = new AbortController();
    graphFetchRef.current = controller;
    try {
      const response = await fetch(`/api/rates?graph=${Date.now()}`, { cache: "no-store", signal: controller.signal });
      const data = await response.json() as RateResponse;
      if (!response.ok || !data.rates || runId !== runIdRef.current) return;
      const adoptedRates = updateRateSnapshot(data.rates, data.syntheticSources, data.syntheticActuals);
      const histories = recordGraphGridPoint();
      auditSlowDirectRates(data.rates, data.syntheticActuals, data.fetchedAt);
      analyzeAllPairs(adoptedRates, histories);
    } catch (error) {
      if (!controller.signal.aborted) console.debug("[FX Rate Speaker graph poll]", error);
    } finally {
      if (graphFetchRef.current === controller) graphFetchRef.current = null;
    }
  }

  function persistOandaShadow() {
    const flattened = Object.values(oandaShadowRef.current)
      .flat()
      .sort((left, right) => left.receivedTimestamp - right.receivedTimestamp)
      .slice(-OANDA_SHADOW_MAX_RECORDS);
    try {
      window.localStorage.setItem(OANDA_SHADOW_STORAGE_KEY, JSON.stringify(flattened));
    } catch {
      // In-memory shadow collection continues if browser storage is full or unavailable.
    }
  }

  function logOandaShadowMetrics(symbol: string, records: OandaShadowRecord[]) {
    const changes = records.filter((record) => record.delta !== null && record.delta !== 0);
    const oneMinuteAgo = Date.now() - 60_000;
    const changesPerMinute = changes.filter((record) => record.receivedTimestamp >= oneMinuteAgo).length;
    const intervals = changes.slice(1).map((record, index) => record.receivedTimestamp - changes[index].receivedTimestamp);
    const currentNoUpdate = changes.length ? Date.now() - changes.at(-1)!.receivedTimestamp : null;
    const leadSamples = changes.flatMap((change) => {
      if (change.yahooPrice === null) return [];
      const yahooCatchUp = records.find((record) => record.receivedTimestamp > change.receivedTimestamp
        && record.yahooPrice !== null && record.yahooPrice !== change.yahooPrice);
      return yahooCatchUp ? [yahooCatchUp.receivedTimestamp - change.receivedTimestamp] : [];
    });
    console.debug("[FX Rate Speaker OANDA shadow]", {
      symbol,
      samples: records.length,
      realPriceChangesPerMinute: changesPerMinute,
      averageUpdateIntervalMs: intervals.length ? Math.round(intervals.reduce((sum, value) => sum + value, 0) / intervals.length) : null,
      maximumNoUpdateMs: intervals.length || currentNoUpdate !== null ? Math.max(...intervals, currentNoUpdate ?? 0) : null,
      averageSecondsEarlierThanYahoo: leadSamples.length ? Number((leadSamples.reduce((sum, value) => sum + value, 0) / leadSamples.length / 1000).toFixed(2)) : null,
      latestDifferencePips: records.at(-1)?.differencePips ?? null,
    });
  }

  function recordOandaPrimary(message: OandaShadowMessage) {
    if (!Number.isFinite(message.mid) || !PAIRS.some((pair) => pair.code === message.symbol)) return;
    const providerMs = Date.parse(message.providerTimestamp);
    const timestamp = Number.isFinite(providerMs)
      ? Math.floor(providerMs / 1000)
      : Math.floor(message.receivedTimestamp / 1000);
    oandaLiveRef.current[message.symbol] = { price: message.mid, timestamp };

    const records = oandaShadowRef.current[message.symbol] ?? [];
    const previous = records.at(-1);
    const yahoo = yahooRatesRef.current[message.symbol];
    const pipSize = message.symbol.endsWith("/JPY") ? 0.01 : 0.0001;
    const record: OandaShadowRecord = {
      ...message,
      delta: previous ? message.mid - previous.mid : null,
      yahooPrice: yahoo?.price ?? null,
      yahooTimestamp: yahoo?.timestamp ?? null,
      differencePips: yahoo ? (message.mid - yahoo.price) / pipSize : null,
    };
    const nextRecords = [...records, record].slice(-2000);
    oandaShadowRef.current[message.symbol] = nextRecords;
    if (nextRecords.length % 20 === 0) {
      persistOandaShadow();
      logOandaShadowMetrics(message.symbol, nextRecords);
    }

    applyAdoptedRates(yahooRatesRef.current);
    setErrors((current) => ({ ...current, [message.symbol]: false }));
  }

  async function refreshOandaHealth() {
    try {
      const response = await fetch(`/api/shadow/oanda?health=1&t=${Date.now()}`, { cache: "no-store" });
      const data = await response.json() as { configured?: boolean; reachable?: boolean };
      if (!data.configured) setOandaStatus("unconfigured");
      else if (!data.reachable) setOandaStatus("error");
      else setOandaStatus((current) => current === "connected" ? current : "checking");
    } catch {
      setOandaStatus("error");
    }
  }

  function startOandaPrimary(runId: number) {
    oandaEventSourceRef.current?.close();
    setOandaStatus("checking");
    void refreshOandaHealth();
    const source = new EventSource("/api/shadow/oanda");
    oandaEventSourceRef.current = source;
    source.onopen = () => {
      if (runId === runIdRef.current && runningRef.current) setOandaStatus("connected");
    };
    source.onmessage = (event) => {
      if (runId !== runIdRef.current || !runningRef.current) return;
      try {
        recordOandaPrimary(JSON.parse(event.data) as OandaShadowMessage);
      } catch {
        // Ignore a malformed OANDA event and continue with the current adopted/fallback rates.
      }
    };
    source.onerror = () => {
      source.close();
      if (oandaEventSourceRef.current === source) oandaEventSourceRef.current = null;
      oandaLiveRef.current = {};
      applyAdoptedRates(yahooRatesRef.current);
      setOandaStatus("fallback");
      void refreshOandaHealth();
      console.debug("[FX Rate Speaker OANDA primary] disconnected; switched to Yahoo fallback");
    };
  }

  async function fetchAndSpeak(runId: number, pairs: string[], seconds: number) {
    if (runId !== runIdRef.current) return;
    setStatus("レート取得中");
    setDetail("");
    const controller = new AbortController();
    abortRef.current = controller;
    try {
      const response = await fetch(`/api/rates?t=${Date.now()}`, {
        cache: "no-store",
        signal: controller.signal,
      });
      const data = await response.json() as RateResponse;
      if (!response.ok) {
        throw new Error(data.error || "レート取得失敗");
      }
      if (!data.rates) throw new Error(data.error || "レート取得失敗");
      if (runId !== runIdRef.current) return;
      const freshRates = data.rates;

      const previousBeforeAnalysis = { ...previousAnalysisRatesRef.current };
      const adoptedRates = updateRateSnapshot(freshRates, data.syntheticSources, data.syntheticActuals);
      const nextSparklineHistories = sparklineHistoriesRef.current;
      analyzeAllPairs(adoptedRates, nextSparklineHistories);
      setErrors(Object.fromEntries(pairs.map((pair) => [pair, !adoptedRates[pair]])));

      const readable = pairs.filter((pair) => adoptedRates[pair]);
      const sequence = readable.map((code) => {
        const pair = PAIRS.find((item) => item.code === code)!;
        const current = adoptedRates[code].price;
        const analysisRate = adoptedRates[code];
        const analysisCurrent = analysisRate.price;
        const previous = previousBeforeAnalysis[code]?.price;
        const direction: Direction = previous !== undefined && analysisCurrent > previous
          ? "up" : previous !== undefined && analysisCurrent < previous ? "down" : "unchanged";
        const movementState = movementTrackerRef.current[code]?.state ?? "NORMAL";
        const audioHistory = (audioPriceHistoryRef.current[code] ?? []).map((point) => point.price);
        const pipSize = pair.yen ? 0.01 : 0.0001;
        const soundHistory = audioHistory.map((price, index) => ({ price, timestamp: index + 1 }));
        const scale = recentMovePips(soundHistory, pipSize, MODE2_POINT_COUNT - 1);
        const mode2Frequencies = scale === null ? [] : buildMode2Frequencies(audioHistory, pipSize, scale);
        return {
          code,
          name: pair.name,
          cue: direction,
          mode2Updated: latestAcceptedRef.current[code] ?? false,
          mode2Frequencies,
          movementState,
          price: spokenPrice(current, pair.yen),
          flow: flowSnapshot(nextSparklineHistories[code] ?? [], direction),
        };
      });
      const commentary = audioModeRef.current === "mode3" || audioModeRef.current === "mode4"
        ? pendingCommentaryRef.current.filter((item) => Date.now() - item.timestamp <= COMMENTARY_QUEUE_STALE_MS).shift() ?? null
        : null;
      if (commentary) pendingCommentaryRef.current = pendingCommentaryRef.current.filter((item) => item.id !== commentary.id);
      if (audioModeRef.current === "mode4") {
        pendingNewsRef.current = pendingNewsRef.current.filter((item) => Date.now() - item.publishedAt <= 5 * 60 * 1000);
      }
      const pendingNews = audioModeRef.current === "mode4" ? pendingNewsRef.current.splice(0, 2) : [];
      if (soundOnRef.current && readable.length) {
        try {
          setStatus("読み上げ中");
          await enqueueAudio(async () => {
            if (runId !== runIdRef.current || !soundOnRef.current) return;
            await Promise.all([
              ...sequence.flatMap((item) => [getSpeechUrl(item.name), getSpeechUrl(item.price)]),
              ...(commentary ? [getSpeechUrl(commentary.text)] : []),
              ...pendingNews.map((item) => getSpeechUrl(newsSpeechText(item))),
            ]);
            const speakCommentary = async () => {
              if (!commentary) return;
              if (commentary.level === "rapid") extendRapidDisplayForAudio(commentary.pair);
              const leadSound: LeadSound = commentary.source === "NEWS"
                ? (commentary.importance ?? "NEWS_L1")
                : commentary.level === "rapid" ? "PRICE_RAPID" : "NONE";
              await playEventLeadSound(leadSound, runId);
              await playCommentaryChime(runId);
              await playSpeech(commentary.text, runId);
              await wait(120);
            };
            if (commentary?.level === "rapid") await speakCommentary();
            for (const news of pendingNews) {
              if (audioModeRef.current !== "mode4" || runId !== runIdRef.current || !soundOnRef.current) break;
              newsSpeechActiveRef.current = true;
              try {
                const text = newsSpeechText(news);
                await playEventLeadSound(news.level, runId);
                await playCommentaryChime(runId);
                await playSpeech(text, runId);
                await wait(120);
              } finally {
                newsSpeechActiveRef.current = false;
              }
            }
            if (commentary?.level !== "rapid") await speakCommentary();
            await playStartChime(runId);
            for (const item of sequence) {
              if (runId !== runIdRef.current || !soundOnRef.current) break;
              await playSpeech(item.name, runId);
              if (!item.mode2Updated) {
                // The source still reports the same observation. Its absence of a cue
                // distinguishes "no update" without adding a duplicate note to the shape.
              } else if (item.mode2Frequencies.length === MODE2_POINT_COUNT) {
                await playMode2Tone(item.mode2Frequencies, item.movementState, runId);
              } else {
                await playRateCue(item.cue, runId);
              }
              await playSpeech(item.price, runId);
              await wait(75);
              latestAcceptedRef.current[item.code] = false;
            }
          });
        } catch {
          setDetail("音声を再生できませんでした。開始ボタンを押し直してください。");
        }
      }
      setStatus("待機中");
    } catch (error) {
      if (controller.signal.aborted || runId !== runIdRef.current) return;
      setErrors(Object.fromEntries(pairs.map((pair) => [pair, true])));
      setStatus("レート取得失敗");
      setDetail(error instanceof Error ? error.message : "通信に失敗しました");
    }
    if (runId === runIdRef.current) {
      nextRunAtRef.current = Date.now() + seconds * 1000;
      workerRef.current?.postMessage({ type: "schedule", delay: seconds * 1000, runId });
    }
  }

  async function start() {
    if (!selected.length) {
      setStatus("通貨ペアを選択してください");
      return false;
    }
    stop();
    try {
      const audio = ensureAudio();
      const context = audioContextRef.current;
      if (!context) throw new Error("音声を初期化できませんでした");
      audio.muted = false;
      applyVolume(volume);
      await context.resume();
      if (context.state !== "running") {
        throw new Error("音声を開始できませんでした");
      }
    } catch (error) {
      runningRef.current = false;
      setRunning(false);
      setStatus("停止中");
      setDetail("音声を開始できませんでした。もう一度Spaceキーを押してください。");
      console.error("FX Rate Speaker audio start failed", error);
      return false;
    }
    const runId = runIdRef.current + 1;
    runIdRef.current = runId;
    resetSessionAnalysisHistory();
    calendarAlertedRef.current.clear();
    lastSummaryAtRef.current = Date.now();
    runningRef.current = true;
    setRunning(true);
    setStatus("開始");
    endAtRef.current = Date.now() + AUTO_STOP_SECONDS * 1000;
    setRemainingSeconds(AUTO_STOP_SECONDS);
    workerRef.current?.postMessage({ type: "clockStart", runId });
    workerRef.current?.postMessage({ type: "graphStart", runId });
    startOandaPrimary(runId);
    countdownRef.current = setInterval(() => {
      const remaining = Math.max(0, Math.ceil((endAtRef.current - Date.now()) / 1000));
      setRemainingSeconds(remaining);
      if (remaining === 0) stop(true);
    }, 1000);
    void fetchAndSpeak(runId, [...selected], intervalSeconds);
    return true;
  }

  async function toggleRunning() {
    if (togglingRef.current) return;
    togglingRef.current = true;
    try {
      if (runningRef.current) stop();
      else await start();
    } finally {
      togglingRef.current = false;
    }
  }

  function togglePair(code: string) {
    setSelected((current) => {
      const next = current.includes(code)
        ? current.filter((item) => item !== code)
        : [...current, code];
      selectedRef.current = next;
      return next;
    });
  }

  useEffect(() => {
    const workerSource = `
      let rateTimer = null;
      let clockTimer = null;
      let graphTimer = null;
      function scheduleGraph(runId) {
        clearTimeout(graphTimer);
        const delay = 10000 - (Date.now() % 10000) + 25;
        graphTimer = setTimeout(() => {
          self.postMessage({ type: 'graph', runId });
          scheduleGraph(runId);
        }, delay);
      }
      function scheduleClock(runId) {
        clearTimeout(clockTimer);
        const now = new Date();
        const next = new Date(now);
        next.setSeconds(0, 0);
        next.setMinutes(next.getMinutes() + (3 - next.getMinutes() % 3));
        clockTimer = setTimeout(() => {
          self.postMessage({ type: 'clock', runId, timestamp: Date.now() });
          scheduleClock(runId);
        }, Math.max(0, next.getTime() - now.getTime()));
      }
      self.onmessage = (event) => {
        if (event.data.type === 'stop') {
          clearTimeout(rateTimer);
          clearTimeout(clockTimer);
          clearTimeout(graphTimer);
          rateTimer = null;
          clockTimer = null;
          graphTimer = null;
          return;
        }
        if (event.data.type === 'schedule') {
          clearTimeout(rateTimer);
          rateTimer = setTimeout(() => self.postMessage({ type: 'tick', runId: event.data.runId }), event.data.delay);
        }
        if (event.data.type === 'clockStart') scheduleClock(event.data.runId);
        if (event.data.type === 'graphStart') scheduleGraph(event.data.runId);
      };
    `;
    const worker = new Worker(URL.createObjectURL(new Blob([workerSource], { type: "text/javascript" })));
    workerRef.current = worker;
    worker.onmessage = (event) => {
      if (event.data.type === "tick" && event.data.runId === runIdRef.current) {
        void fetchAndSpeak(runIdRef.current, [...selectedRef.current], intervalSeconds);
      }
      if (event.data.type === "clock" && event.data.runId === runIdRef.current) {
        speakCurrentTime(runIdRef.current, event.data.timestamp);
      }
      if (event.data.type === "graph" && event.data.runId === runIdRef.current) {
        void refreshGraphRates(runIdRef.current);
      }
    };
    return () => worker.terminate();
  }, [intervalSeconds]);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      const target = event.target;
      const isTextEntry = target instanceof HTMLTextAreaElement
        || (target instanceof HTMLInputElement
          && ["text", "search", "url", "email", "tel", "password"].includes(target.type))
        || (target instanceof HTMLElement && target.isContentEditable);
      const isSpace = event.code === "Space" || event.key === " " || event.key === "Spacebar";
      if (isSpace && !isTextEntry) {
        event.preventDefault();
        event.stopPropagation();
        if (event.repeat || event.isComposing) return;
        void toggleRunning();
        return;
      }
      if (event.repeat) return;
      const isFormControl = target instanceof HTMLInputElement
        || target instanceof HTMLTextAreaElement
        || target instanceof HTMLSelectElement
        || (target instanceof HTMLElement && target.isContentEditable);
      if ((event.key === "m" || event.key === "M") && !isFormControl) {
        event.preventDefault();
        event.stopPropagation();
        applySoundEnabled(!soundOnRef.current);
        return;
      }
      if (event.key === "ArrowLeft" || event.key === "ArrowRight") {
        event.preventDefault();
        event.stopPropagation();
        applyVolume(volumeRef.current * 100 + (event.key === "ArrowRight" ? 5 : -5));
      }
    };
    window.addEventListener("keydown", onKeyDown, true);
    return () => window.removeEventListener("keydown", onKeyDown, true);
  });

  const latestCommentary = [...commentaryHistory].sort((left, right) => right.timestamp - left.timestamp)[0];
  const visibleCommentaryHistory = selectVisibleHistory(commentaryHistory, currentTime);
  const currentMarketNotice = activeMarketNotice(marketNotices, currentTime);
  const marketMessage = currentMarketNotice?.message || fallbackMarketProverb(currentTime);
  const upcomingCalendarEvent = calendarEvents.find((event) => {
    const minutes = (event.scheduledAt - currentTime) / 60_000;
    return minutes >= 0 && minutes <= CALENDAR_AMBER_MINUTES;
  }) ?? null;
  const upcomingCalendarMinutes = upcomingCalendarEvent
    ? Math.max(0, Math.ceil((upcomingCalendarEvent.scheduledAt - currentTime) / 60_000))
    : null;
  const strengthResults = useMemo(() => Object.fromEntries(CURRENCY_STRENGTH_WINDOWS.map((windowSize) => [
    windowSize,
    calculateCurrencyStrength(sparklineHistories, windowSize),
  ])) as Record<number, ReturnType<typeof calculateCurrencyStrength>>, [sparklineHistories]);

  useEffect(() => {
    const nextDisplayScores: Record<number, Record<string, number>> = {};
    CURRENCY_STRENGTH_WINDOWS.forEach((windowSize) => {
      const result = strengthResults[windowSize];
      const historyLimit = STRENGTH_TREND_HISTORY[windowSize];
      const windowHistory = strengthTrendHistoryRef.current[windowSize] ?? {};
      const nextWindowHistory: Record<string, number[]> = { ...windowHistory };
      const nextWindowDisplay: Record<string, number> = {};

      STRENGTH_PAIR_CODES.forEach((pairCode) => {
        const rawDifference = result.pairScores[pairCode] ?? 0;
        const nextHistory = [...(windowHistory[pairCode] ?? []), rawDifference].slice(-historyLimit);
        nextWindowHistory[pairCode] = nextHistory;
        nextWindowDisplay[pairCode] = result.ready ? trendAwareStrengthDifference(nextHistory, windowSize) : 0;
      });

      strengthTrendHistoryRef.current[windowSize] = nextWindowHistory;
      nextDisplayScores[windowSize] = nextWindowDisplay;
    });
    setStrengthDisplayScores(nextDisplayScores);
  }, [strengthResults]);

  useEffect(() => {
    CURRENCY_STRENGTH_WINDOWS.forEach((windowSize) => {
      const result = strengthResults[windowSize];
      const previous = previousStrengthScoresRef.current[windowSize];
      const delta = result.scores && previous
        ? Object.fromEntries(STRENGTH_CURRENCIES.map((currency) => [
            currency,
            Number((result.scores![currency] - previous[currency]).toFixed(2)),
          ]))
        : null;
      console.debug("FX Rate Speaker currency strength", {
        window: windowSize,
        raw: result.raw,
        normalized: result.scores,
        pairSignals: result.pairSignals,
        pairScores: result.pairScores,
        delta,
        usedPairs: result.usedPairs,
        periods: Object.fromEntries(STRENGTH_PAIR_CODES.map((pairCode) => {
          const points = (sparklineHistories[pairCode] ?? []).slice(-windowSize);
          return [pairCode, {
            usedPointCount: points.length,
            startTimestamp: points[0]?.timestamp ?? null,
            endTimestamp: points.at(-1)?.timestamp ?? null,
          }];
        })),
        updatedAt: new Date(lastGraphGridRef.current ? lastGraphGridRef.current * 1000 : Date.now()).toISOString(),
      });
      if (result.scores) previousStrengthScoresRef.current[windowSize] = result.scores;
    });
  }, [strengthResults]);

  return (
    <main>
      <div className="workspace-grid">
        <aside className="control-column panel">
          <header className="brand-block">
            <p className="eyebrow">FX RATE SPEAKER</p>
            <div className="brand-title-row">
              <h1>FXレート読み上げ</h1>
              <button className={`main-action compact ${running ? "stop" : "start"}`} onClick={() => { void toggleRunning(); }}>
                {running ? "停止" : "開始"}<span>（Space）</span>
              </button>
            </div>
            <div className="brand-meta"><strong>{FX_RATE_SPEAKER_VERSION_LABEL}</strong><span className={running ? "live" : ""}>{status}</span></div>
          </header>
          {detail && <div className="error-banner" role="alert">{detail}</div>}
          <time className={`control-clock ${isClockAlertWindow(currentTime) ? "alert-window" : ""}`} dateTime={new Date(currentTime).toISOString()}>{formatLiveDateTime(currentTime)}</time>
          <section className={`market-notice ${currentMarketNotice ? "scheduled" : "proverb"} ${upcomingCalendarEvent ? "indicator-near" : ""}`} aria-live="polite">
            {upcomingCalendarEvent && upcomingCalendarMinutes !== null && (
              <div className={`market-calendar-alert ${calendarProximityClass(upcomingCalendarMinutes)}`}>
                <span>⚠ 重要指標まで{upcomingCalendarMinutes}分</span>
                <strong>{upcomingCalendarEvent.currency} {upcomingCalendarEvent.title}</strong>
              </div>
            )}
            <div className="market-notice-head">
              <span>{currentMarketNotice ? marketNoticeDisplayRange(currentMarketNotice, currentTime) : "MARKET NOTE"}</span>
              <button type="button" onClick={() => setMarketNoticeAdminOpen(true)}>管理</button>
            </div>
            <strong>{marketMessage}</strong>
          </section>
          <div className="two-control-grid">
            <div className="setting-box">
              <span>モード</span>
              <div className="mode-buttons" role="group" aria-label="音モード">
                <button className={audioMode === "mode2" ? "chosen" : ""} onClick={() => applyAudioMode("mode2")}>2</button>
                <button className={audioMode === "mode3" ? "chosen radio-mode" : "radio-mode"} onClick={() => applyAudioMode("mode3")}>3 実況</button>
                <button className={audioMode === "mode4" ? "chosen news-mode" : "news-mode"} onClick={() => applyAudioMode("mode4")}>4 NEWS</button>
              </div>
            </div>
            <div className="setting-box">
              <span>間隔</span>
              <div className="intervals">
                {[30, 60].map((seconds) => (
                  <button key={seconds} className={intervalSeconds === seconds ? "chosen" : ""}
                    onClick={() => setIntervalSeconds(seconds)} disabled={running}>{seconds}</button>
                ))}
              </div>
            </div>
          </div>
          <label className="volume-control">
            <span>音量</span>
            <input type="range" min="0" max="100" step="5" value={volume}
              onChange={(event) => applyVolume(Number(event.target.value))} aria-label="読み上げ音量" />
            <strong>{volume}%</strong>
          </label>
          <p className="fixed-speed">読み上げ速度 1.5倍固定</p>
          <div className="status-row">
            <label className="sound-switch">
              <input type="checkbox" checked={soundOn} onChange={(event) => applySoundEnabled(event.target.checked)} />
              <span>音声 {soundOn ? "ON" : "OFF"}（M）</span>
            </label>
            <div className={`countdown ${running ? "active" : ""}`}><span>自動停止</span><strong>{formatRemaining(remainingSeconds)}</strong></div>
          </div>
          <div className="strength-grid" aria-label="通貨強弱">
            {CURRENCY_STRENGTH_WINDOWS.map((windowSize) => (
              <StrengthPentagon
                key={windowSize}
                label={windowSize}
                result={strengthResults[windowSize]}
                displayPairScores={strengthDisplayScores[windowSize] ?? strengthResults[windowSize].pairScores}
              />
            ))}
          </div>
          <p className="source-note">
            <span className={`oanda-status ${oandaStatus}`}>
              {oandaStatus === "connected" ? "OANDA 接続中"
                : oandaStatus === "unconfigured" ? "OANDA 未設定 / Yahoo予備"
                  : oandaStatus === "error" ? "OANDA 接続失敗 / Yahoo予備"
                    : oandaStatus === "fallback" ? "OANDA 切断 / Yahoo予備"
                      : "OANDA 確認中"}
            </span><br />
            OANDA優先・Yahoo予備<br />傾向・急変は採用レートの直近{VOLATILITY_WINDOW}変化で自動判定
          </p>
        </aside>

        <section className="rate-column panel">
          <div className="rate-list">
            {PAIRS.map((pair) => {
              const rate = rates[pair.code];
              const rateSource = rateSources[pair.code];
              const useSyntheticDisplay = rateSource === "OANDA_SYNTHETIC";
              const visibleRate = rate;
              const failed = errors[pair.code];
              const displayFailed = Boolean(failed && !visibleRate);
              const displayState = rateDisplayStates[pair.code];
              const history = sparklineHistories[pair.code] ?? [];
              const longHistory = history.slice(-SPARKLINE_LONG_WINDOW);
              const chartHistory = history.slice(-SPARKLINE_BASE_WINDOW);
              const midHistory = history.slice(-SPARKLINE_MID_WINDOW);
              const recentHistory = history.slice(-SPARKLINE_RECENT_WINDOW);
              const longDirection = visualDirection(longHistory, displayState?.direction);
              const chartDirection = visualDirection(chartHistory, longDirection);
              const midDirection = visualDirection(midHistory, chartDirection);
              const recentDirection = visualDirection(recentHistory, midDirection);
              const movement = displayState?.movement ?? "NORMAL";
              const rapid = movement === "RAPID_UP" || movement === "RAPID_DOWN";
              const pipSize = pair.yen ? 0.01 : 0.0001;
              const volatility = shortVolatilityLevel(history, pipSize);
              const recentPastRates = previousGraphGridRates(history, currentTime);
              const npYen = visibleRate ? normalizedPipValue(visibleRate.price, pipSize) : null;
              return (
                <article className={`rate-row state-${movement.toLowerCase()} ${selected.includes(pair.code) ? "selected" : ""} ${displayFailed ? "error" : ""} ${rapid ? "rapid" : ""}`} key={pair.code}
                  onClick={() => togglePair(pair.code)} aria-pressed={selected.includes(pair.code)}
                  role="button" tabIndex={0}
                  onKeyDown={(event) => { if (event.key === "Enter") togglePair(pair.code); }}
                  aria-label={`${pair.code}を読み上げ対象${selected.includes(pair.code) ? "から外す" : "にする"}`}>
                  <div className="rate-identity">
                    <div className="rate-title"><span className="selection-dot" /><strong>{pair.code}</strong></div>
                    <div className="rate-meta">
                      <time>{visibleRate && !displayFailed ? new Date(visibleRate.timestamp * 1000).toLocaleTimeString("ja-JP", { hour12: false }) : "--:--:--"}</time>
                      <span className={`volatility-badge v${volatility}`} title={`短期ボラティリティ V${volatility}`}>V{volatility}</span>
                    </div>
                  </div>
                  <div className="spark-slot">
                    <Sparkline history={history} movement={movement} direction={chartDirection} />
                  </div>
                  <div className="rate-summary">
                    <div className="rate-value-line">
                      {movement !== "NORMAL" && (
                        <span className={`movement ${movement}`} title={movementLabel(movement)} aria-label={movementLabel(movement)}>{movementSymbol(movement)}</span>
                      )}
                      <div className={`rate-value ${useSyntheticDisplay ? "synthetic" : ""}`}
                        title={useSyntheticDisplay ? "OANDA Syntheticレート" : rateSource === "YAHOO" ? "Yahooレート" : "OANDA直接レート"}>
                        {displayFailed ? "取得失敗" : visibleRate ? displayPrice(visibleRate.price, pair.yen) : "---"}
                      </div>
                    </div>
                    <div className="rate-badges">
                      <span className="flow-badge" title={`60点 ${directionLabel(longDirection)}・30点 ${directionLabel(chartDirection)}・15点 ${directionLabel(midDirection)}・7点 ${directionLabel(recentDirection)}`}>
                        <FlowDirection label="60" direction={longDirection} history={longHistory} requiredPoints={SPARKLINE_LONG_WINDOW} />
                        <FlowDirection label="30" direction={chartDirection} history={chartHistory} requiredPoints={SPARKLINE_BASE_WINDOW} />
                        <FlowDirection label="15" direction={midDirection} history={midHistory} requiredPoints={SPARKLINE_MID_WINDOW} />
                        <FlowDirection label="7" direction={recentDirection} history={recentHistory} requiredPoints={SPARKLINE_RECENT_WINDOW} />
                      </span>
                    </div>
                  </div>
                  <div className="rate-history-stats" aria-label={`${pair.code} 直近3回・NP`}>
                    {[0, 1, 2].map((index) => (
                      <span className="history-digit" key={index} title={`直近${index + 1}回前の10秒固定レート`}>
                        {recentPastRates[index] ? lastThreeRateDigits(recentPastRates[index].price, pair.yen) : "---"}
                      </span>
                    ))}
                    <span className="np-value" title="証拠金10万円・レバレッジ25倍時の1pip円額">
                      {npYen === null ? "--" : Math.round(npYen)}
                    </span>
                  </div>
                </article>
              );
            })}
          </div>
        </section>

        <section className={`radio-column panel ${audioMode === "mode3" || audioMode === "mode4" ? "enabled" : ""}`} aria-live="polite">
          <div className="latest-zone">
            {latestCommentary ? (
              <article className={`latest-commentary ${latestCommentary.level} ${latestCommentary.source.toLowerCase()}`}>
                <div className="latest-summary-line">
                  <time>{new Date(latestCommentary.timestamp).toLocaleTimeString("ja-JP", { hour12: false })}</time>
                  <strong>{latestCommentary.pair}</strong>
                  <span>{latestCommentary.source === "NEWS" ? latestCommentary.importance?.replace("NEWS_L", "NEWS ") ?? "NEWS 1" : latestCommentary.kind}</span>
                </div>
                {latestCommentary.headline && <p className="news-headline">{latestCommentary.headline}</p>}
                <p>{latestCommentary.text}</p>
              </article>
            ) : (
              <div className="latest-empty">
                <strong>実況待機中</strong>
                <p>{audioMode === "mode4"
                  ? `市場実況と公式NEWSを監視しています。${newsStatus === "error" ? " NEWS ERROR" : ""}`
                  : audioMode === "mode3"
                    ? "市場イベントを監視しています。定期実況は開始から5分後です。"
                    : "モード3または4を選ぶと実況を開始します。"}</p>
              </div>
            )}
          </div>
          <div className="history-zone">
            <div className="history-feed">
              {visibleCommentaryHistory.map((entry) => (
                <article className={`history-row ${entry.level} ${entry.source.toLowerCase()}`} key={entry.id}>
                  <div className="history-meta">
                    <time>{new Date(entry.timestamp).toLocaleTimeString("ja-JP", { hour12: false, hour: "2-digit", minute: "2-digit" })}</time>
                    <span className="feed-kind">{entry.source === "NEWS" ? entry.importance?.replace("NEWS_L", "NEWS ") ?? "NEWS 1" : entry.kind}</span>
                    <strong>{entry.pair}</strong>
                  </div>
                  <div className="feed-text">
                    {entry.headline && <p className="news-headline">{entry.headline}</p>}
                    <p>{entry.text}</p>
                  </div>
                </article>
              ))}
              {!visibleCommentaryHistory.length && <p className="history-empty">実況履歴はまだありません。</p>}
              {audioMode === "mode4" ? (
                <article className={`history-row news news-receiver ${newsStatus === "error" ? "error" : ""}`}>
                  <div className="history-meta"><time>--:--</time><span className="feed-kind">NEWS 1–3</span><strong>{newsStatus === "error" ? "NEWS ERROR" : "公式RSS受信中"}</strong></div>
                  <div className="feed-text"><p>{newsStatus === "error" ? "NEWSのみ再試行します。レートと相場実況は継続します。" : "FRB・日銀・ECB・BOE・RBA・米労働統計を60秒間隔で確認します。"}</p></div>
                </article>
              ) : (
                <article className="history-row news news-receiver">
                  <div className="history-meta"><time>--:--</time><span className="feed-kind">NEWS OFF</span><strong>モード4専用</strong></div>
                  <div className="feed-text"><p>モード2・3ではNEWS通信・表示・読み上げを行いません。</p></div>
                </article>
              )}
            </div>
          </div>
          <div className="calendar-zone">
            {calendarEvents.length ? (
              <div className="calendar-list">
                {calendarEvents.slice(0, 3).map((event) => {
                  const minutes = Math.round((event.scheduledAt - currentTime) / 60_000);
                  const remaining = minutes > 0 ? `あと${minutes}分` : minutes >= -20 ? "発表済み" : "終了";
                  const figures = event.actual
                    ? `結${event.actual} 予${event.forecast ?? "--"} 前${event.previous ?? "--"}`
                    : `予${event.forecast ?? "--"} 前${event.previous ?? "--"}`;
                  return <article className={`calendar-row ${event.level.toLowerCase()} ${calendarProximityClass(minutes)}`} key={event.id}>
                    <b className={`currency-badge ${event.currency.toLowerCase()}`}>{event.currency}</b>
                    <time>{new Date(event.scheduledAt).toLocaleTimeString("ja-JP", { hour: "2-digit", minute: "2-digit", hour12: false, timeZone: "Asia/Tokyo" })}</time>
                    <strong title={event.title}>{event.title}</strong><span className="calendar-figures">{figures}</span><span>{remaining}</span><em>{event.level}</em>
                  </article>;
                })}
              </div>
            ) : <p className="calendar-empty">{calendarStatus === "error" || calendarStatus === "stale" ? "指標情報を再取得しています" : "重要指標を確認中"}</p>}
          </div>
        </section>
      </div>
      {marketNoticeAdminOpen && (
        <div className="notice-admin-backdrop" role="presentation" onMouseDown={(event) => {
          if (event.currentTarget === event.target) setMarketNoticeAdminOpen(false);
        }}>
          <section className="notice-admin" role="dialog" aria-modal="true" aria-labelledby="notice-admin-title">
            <header>
              <div><p>MARKET NOTICE</p><h2 id="notice-admin-title">時間帯メッセージ管理</h2></div>
              <button type="button" onClick={() => setMarketNoticeAdminOpen(false)} aria-label="閉じる">×</button>
            </header>
            <p className="notice-admin-help">入力時刻は日本時間表示です。LDN／NYを選ぶと夏時間・冬時間に合わせて自動で1時間移動します。上の項目を優先します。</p>
            <div className="notice-admin-list">
              {marketNotices.map((notice) => (
                <article className="notice-admin-row" key={notice.id}>
                  <input className="notice-message-input" value={notice.message} aria-label="表示メッセージ"
                    onChange={(event) => updateMarketNotice(notice.id, { message: event.target.value })} />
                  <div className="notice-time-row">
                    <select value={notice.timeBasis} aria-label="時刻基準"
                      onChange={(event) => changeMarketNoticeTimeBasis(notice, event.target.value as MarketNoticeTimeBasis)}>
                      {MARKET_NOTICE_TIME_BASIS_OPTIONS.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
                    </select>
                    <input type="time" value={marketNoticeJstTime(notice.timeBasis, notice.start, currentTime)} aria-label="開始時刻（日本時間）"
                      onChange={(event) => updateMarketNotice(notice.id, { start: marketNoticeSourceTime(notice.timeBasis, event.target.value, currentTime) })} />
                    <span>〜</span>
                    <input type="time" value={marketNoticeJstTime(notice.timeBasis, notice.end, currentTime)} aria-label="終了時刻（日本時間）"
                      onChange={(event) => updateMarketNotice(notice.id, { end: marketNoticeSourceTime(notice.timeBasis, event.target.value, currentTime) })} />
                    <button className="notice-delete" type="button" onClick={() => setMarketNotices((current) => current.filter((item) => item.id !== notice.id))}>削除</button>
                  </div>
                  <div className="notice-weekdays" role="group" aria-label="表示曜日">
                    {WEEKDAYS.map((day) => (
                      <button type="button" key={day.value} className={notice.weekdays.includes(day.value) ? "chosen" : ""}
                        onClick={() => toggleMarketNoticeWeekday(notice.id, day.value)}>{day.label}</button>
                    ))}
                  </div>
                </article>
              ))}
            </div>
            <footer>
              <button type="button" onClick={() => setMarketNotices(DEFAULT_MARKET_NOTICES.map((notice) => ({ ...notice, weekdays: [...notice.weekdays] })))}>初期候補に戻す</button>
              <button className="notice-add" type="button" onClick={addMarketNotice}>＋ 項目を追加</button>
              <button className="notice-done" type="button" onClick={() => setMarketNoticeAdminOpen(false)}>完了</button>
            </footer>
          </section>
        </div>
      )}
    </main>
  );
}
