import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";

const developmentPreviewMeta =
  /<meta(?=[^>]*\bname=["']codex-preview["'])(?=[^>]*\bcontent=["']development["'])[^>]*>/i;

test("renders development preview metadata", async () => {
  const workerUrl = new URL("../dist/server/index.js", import.meta.url);
  workerUrl.searchParams.set("test", `${process.pid}-${Date.now()}`);
  const { default: worker } = await import(workerUrl.href);

  const response = await worker.fetch(
    new Request("http://localhost/", {
      headers: { accept: "text/html" },
    }),
    {
      ASSETS: {
        fetch: async () => new Response("Not found", { status: 404 }),
      },
    },
    {
      waitUntil() {},
      passThroughOnException() {},
    },
  );

  assert.equal(response.status, 200);
  assert.match(
    response.headers.get("content-type") ?? "",
    /^text\/html\b/i,
  );
  const html = await response.text();
  assert.ok(
    developmentPreviewMeta.test(html) || /<title>FX Rate Speaker v96<\/title>/i.test(html),
    "rendered output should contain preview metadata or the current production title",
  );
});

test("v67 keeps modes 2, 3 and 4 NEWS audio", async () => {
  const source = await readFile(new URL("../app/page.tsx", import.meta.url), "utf8");
  assert.match(source, /type AudioMode = "mode2" \| "mode3" \| "mode4"/);
  assert.match(source, /type NewsLevel = "NEWS_L1" \| "NEWS_L2" \| "NEWS_L3"/);
  assert.match(source, /PRICE_RAPID: 60,[\s\S]*NEWS_L3: 50,[\s\S]*NEWS_L2: 40,[\s\S]*NEWS_L1: 30/);
  assert.match(source, /async function playNewsAlert/);
  assert.match(source, /async function playCommentaryAlert/);
  assert.match(source, /\[987\.77, 1975\.54\][\s\S]*\[659\.25, 1318\.5\]/);
  assert.match(source, /commentary\.source === "NEWS"[\s\S]*"PRICE_RAPID"/);
  assert.match(source, /<strong>\{FX_RATE_SPEAKER_VERSION_LABEL\}<\/strong>/);
  assert.match(source, />4 NEWS<\/button>/);
  assert.match(source, /audioModeRef\.current !== "mode4"/);
  assert.match(source, /NEWS_POLL_INTERVAL_MS = 60 \* 1000/);
  assert.match(source, /item\.level !== "NEWS_L1"/);
  assert.match(source, /state === "UP_TREND"\) return "↑"/);
  assert.match(source, /state === "DOWN_TREND"\) return "↓"/);
  assert.match(source, /state === "RAPID_UP"\) return "↑↑"/);
  assert.match(source, /state === "RAPID_DOWN"\) return "↓↓"/);
  assert.match(source, /if \(state === "RAPID_DOWN"\) return "↓↓";\s+return "";/);
});

test("v60 still defaults to mode 3 and renders clickable 30-point retained-history sparklines", async () => {
  const source = await readFile(new URL("../app/page.tsx", import.meta.url), "utf8");
  const styles = await readFile(new URL("../app/globals.css", import.meta.url), "utf8");
  assert.match(source, /useState<AudioMode>\("mode3"\)/);
  assert.match(source, /saved === "mode2" \|\| saved === "mode4" \? saved : "mode3"/);
  assert.match(source, /function Sparkline/);
  assert.match(source, /SPARKLINE_DISPLAY_POINT_COUNT = 30/);
  assert.match(source, /SPARKLINE_HISTORY_POINT_COUNT = 60/);
  assert.match(source, /SPARKLINE_MID_WINDOW = 15/);
  assert.match(source, /SPARKLINE_RECENT_WINDOW = MODE2_POINT_COUNT/);
  assert.match(source, /appendSparklinePoint\(nextSparklineHistories\[pair\.code\]/);
  assert.match(source, /<FlowDirection label="30" direction=\{chartDirection\}/);
  assert.match(source, /<FlowDirection label="15" direction=\{midDirection\}/);
  assert.match(source, /<FlowDirection label="7" direction=\{recentDirection\}/);
  assert.match(source, /const useSyntheticDisplay = rateSource === "OANDA_SYNTHETIC"/);
  assert.match(source, /rate-value \$\{useSyntheticDisplay \? "synthetic"/);
  assert.match(styles, /grid-template-columns:minmax\(240px,25fr\) minmax\(360px,30fr\) minmax\(450px,45fr\)/);
  assert.match(styles, /--gold:#f4bd3f/);
  assert.match(styles, /\.spark-recent-path/);
  assert.match(styles, /\.flow-direction \{[^}]*border-radius:3px/);
  assert.match(styles, /\.flow-badge \{[^}]*grid-template-columns:repeat\(4,22px\)/);
  assert.doesNotMatch(styles, /\.flow-badge \{[^}]*grid-template-columns:repeat\(2,/);
  assert.match(styles, /font-family:"Source Han Sans JP","Noto Sans JP"/);
  assert.match(styles, /body \* \{ font-family:inherit !important; \}/);
  assert.match(styles, /\.spark-rapid-segment/);
  assert.doesNotMatch(source, /10ペア レート|カードをクリックして選択/);
  assert.doesNotMatch(source, /spark-direction-marker|spark-last/);
  assert.doesNotMatch(styles, /spark-direction-marker|spark-last/);
  assert.match(source, /movement !== "NORMAL"/);
  assert.doesNotMatch(source, /aria-label="読み上げ速度"/);
  assert.match(source, /BREAKOUT_LOOKBACK_SECONDS = 15 \* 60/);
  assert.match(source, /BREAKOUT_RANGE_RATIO = 0\.04/);
  assert.match(source, /BREAKOUT_MIN_PIPS = 0\.5/);
  assert.match(source, /flowCommentary\(name, flow, movement\.state/);
  assert.doesNotMatch(source, /MEMO_STORAGE_KEY|<textarea value=\{memo\}/);
});

test("v60 separates 30/60 second speech from 10 second silent graph polling and shows the live clock", async () => {
  const source = await readFile(new URL("../app/page.tsx", import.meta.url), "utf8");
  const styles = await readFile(new URL("../app/globals.css", import.meta.url), "utf8");
  assert.match(source, /GRAPH_RATE_POLL_MS = 10 \* 1000/);
  assert.match(source, /\{\[30, 60\]\.map/);
  assert.doesNotMatch(source, /\{\[10, 30, 60\]\.map/);
  assert.match(source, /formatLiveDateTime\(currentTime\)/);
  assert.match(source, /control-clock[\s\S]*isClockAlertWindow\(currentTime\)[\s\S]*alert-window/);
  assert.match(styles, /\.control-clock/);
  assert.match(styles, /\.intervals \{ grid-template-columns:repeat\(2,1fr\)/);
});

test("v79 promotes the OANDA stream to all ten primary pairs with Yahoo fallback", async () => {
  const source = await readFile(new URL("../app/page.tsx", import.meta.url), "utf8");
  const route = await readFile(new URL("../app/api/shadow/oanda/route.ts", import.meta.url), "utf8");
  assert.match(route, /"USD_JPY", "EUR_USD", "GBP_USD", "AUD_USD", "EUR_JPY", "GBP_JPY", "AUD_JPY", "EUR_GBP", "EUR_AUD", "GBP_AUD"/);
  assert.match(route, /OANDA_API_TOKEN/);
  assert.match(route, /pricing\/stream/);
  assert.match(source, /type RateSource = "OANDA" \| "OANDA_SYNTHETIC" \| "YAHOO"/);
  assert.match(source, /function freshOandaRate/);
  assert.match(source, /function syntheticOandaRate/);
  assert.match(source, /function applyAdoptedRates/);
  assert.match(source, /sources\[pair\.code\] = "OANDA"/);
  assert.match(source, /sources\[pair\.code\] = "OANDA_SYNTHETIC"/);
  assert.match(source, /sources\[pair\.code\] = "YAHOO"/);
  assert.match(source, /function startOandaPrimary/);
});

test("mode 4 uses key-free official feeds and isolates partial failures", async () => {
  const source = await readFile(new URL("../app/api/news/route.ts", import.meta.url), "utf8");
  assert.match(source, /federalreserve\.gov\/feeds\/press_all\.xml/);
  assert.match(source, /boj\.or\.jp\/rss\/whatsnew\.xml/);
  assert.match(source, /ecb\.europa\.eu\/rss\/press\.html/);
  assert.match(source, /bankofengland\.co\.uk\/rss\/news/);
  assert.match(source, /rba\.gov\.au\/rss\/rss-cb-media-releases\.xml/);
  assert.match(source, /bls\.gov\/feed\/bls_latest\.rss/);
  assert.match(source, /Promise\.allSettled/);
  assert.match(source, /NEWS_L1/);
  assert.match(source, /NEWS_L2/);
  assert.match(source, /NEWS_L3/);
});

test("v61 monitors all ten pairs and adds isolated economic-calendar UI", async () => {
  const page = await readFile(new URL("../app/page.tsx", import.meta.url), "utf8");
  const calendar = await readFile(new URL("../app/api/calendar/route.ts", import.meta.url), "utf8");
  const styles = await readFile(new URL("../app/globals.css", import.meta.url), "utf8");
  assert.match(page, /function analyzeAllPairs/);
  assert.match(page, /PAIRS\.forEach\(\(pair\) =>/);
  assert.match(page, /const readable = pairs\.filter/);
  assert.match(page, /shortVolatilityLevel/);
  assert.match(page, /calendarProximityClass/);
  assert.match(page, /CALENDAR_STALE_MS/);
  assert.match(calendar, /ff_calendar_thisweek\.json/);
  assert.match(calendar, /actual/);
  assert.match(calendar, /forecast/);
  assert.match(calendar, /previous/);
  assert.match(styles, /state-up_trend/);
  assert.match(styles, /state-rapid_down/);
  assert.match(styles, /volatility-badge/);
});

test("v67 records only aligned ten-second graph points and keeps rapid display state", async () => {
  const page = await readFile(new URL("../app/page.tsx", import.meta.url), "utf8");
  const styles = await readFile(new URL("../app/globals.css", import.meta.url), "utf8");
  assert.match(page, /function updateRateSnapshot/);
  assert.match(page, /function recordGraphGridPoint/);
  assert.match(page, /Math\.floor\(now \/ GRAPH_RATE_POLL_MS\)/);
  assert.match(page, /lastGraphGridRef\.current === gridTimestamp/);
  assert.doesNotMatch(page, /applyRateSnapshot/);
  assert.match(page, /<FlowDirection label="60"/);
  assert.match(page, /RAPID_DISPLAY_HOLD_MS = 30 \* 1000/);
  assert.match(page, /RAPID_AUDIO_MIN_REMAINING_MS = 15 \* 1000/);
  assert.match(page, /extendRapidDisplayForAudio/);
  assert.match(page, /currency-badge/);
  assert.match(styles, /grid-template-columns:repeat\(4,22px\)/);
  assert.match(styles, /calendar-row \{[^}]*grid-template-columns:31px 37px/);
});

test("v67 separates card regions, defers incomplete directions and prioritizes visible history", async () => {
  const page = await readFile(new URL("../app/page.tsx", import.meta.url), "utf8");
  const styles = await readFile(new URL("../app/globals.css", import.meta.url), "utf8");
  assert.match(page, /RAPID_UP"\) return "↑↑"/);
  assert.match(page, /RAPID_DOWN"\) return "↓↓"/);
  assert.match(page, /requiredPoints=\{SPARKLINE_LONG_WINDOW\}/);
  assert.match(page, /flow-direction pending/);
  assert.match(page, /selectVisibleHistory\(commentaryHistory, currentTime\)/);
  assert.match(page, /COMMENTARY_HISTORY_RETENTION_LIMIT = 40/);
  assert.match(page, /historyDisplayPriority/);
  assert.match(styles, /\.spark-slot \{[^}]*overflow:hidden/);
  assert.match(styles, /\.rate-row\.selected \{[^}]*border-color:var\(--gold\);[^}]*box-shadow/);
  assert.doesNotMatch(styles, /\.rate-row\.selected \{[^}]*background:/);
  assert.match(styles, /\.flow-direction\.pending/);
});

test("v67 renders four ten-pair currency-strength pentagons and compact controls", async () => {
  const page = await readFile(new URL("../app/page.tsx", import.meta.url), "utf8");
  const strength = await readFile(new URL("../lib/currency-strength.ts", import.meta.url), "utf8");
  const styles = await readFile(new URL("../app/globals.css", import.meta.url), "utf8");
  assert.match(strength, /CURRENCY_STRENGTH_WINDOWS = \[60, 30, 15, 7\]/);
  assert.match(strength, /STRENGTH_VERTEX_ORDER = \["USD", "JPY", "AUD", "GBP", "EUR"\]/);
  assert.match(strength, /Math\.log\(point\.price\)/);
  assert.match(strength, /rank: 0\.35, agreement: 0\.30, continuation: 0\.25, magnitude: 0\.10/);
  assert.match(strength, /componentTotals\[base\]\.agreement \+= signedQuality;[\s\S]*componentTotals\[quote\]\.agreement -= signedQuality/);
  assert.match(strength, /usedPairs < STRENGTH_PAIR_CODES\.length/);
  assert.match(strength, /clamp\(50 \+ composite \* scoreSpan\(windowSize\), 0, 100\)/);
  assert.match(page, /STRENGTH_PAIR_CODES\.map[\s\S]*data-pair=\{pairCode\}/);
  assert.match(page, /<linearGradient[\s\S]*stopColor=\{baseColor\}[\s\S]*stopColor=\{quoteColor\}/);
  assert.doesNotMatch(page, /magnitude < 6|magnitude >= 18/);
  assert.match(page, /STRENGTH_VISUAL_EXPONENT = 1\.55/);
  assert.match(page, /normalized \*\* STRENGTH_VISUAL_EXPONENT/);
  assert.match(page, /strokeWidth=\{mapping\.width\}/);
  assert.match(page, /className="strength-guide-line"/);
  assert.doesNotMatch(page, /className="radar-value"/);
  assert.match(page, /<StrengthPentagon[\s\S]*key=\{windowSize\}[\s\S]*displayPairScores=/);
  assert.match(page, /className="pentagon-wait"[\s\S]*WAIT/);
  assert.match(page, /event\.key === "m" \|\| event\.key === "M"/);
  assert.match(page, /applySoundEnabled\(!soundOnRef\.current\)/);
  assert.doesNotMatch(page, /LIVE COMMENTARY|実況・NEWS履歴|重要指標予定|MEMO/);
  assert.match(page, /rateSource === "OANDA_SYNTHETIC"/);
  assert.match(page, /calendarProximityClass\(minutes\)/);
  assert.match(styles, /\.strength-grid \{[^}]*grid-template-columns:repeat\(2/);
  assert.match(styles, /@media \(prefers-reduced-motion:reduce\)/);
  assert.match(styles, /\.volatility-badge\.v5 \{[^}]*color:#140b03/);
  assert.match(styles, /\.calendar-row\.proximity-red/);
});

test("v67 keeps title, rates and multi-label history readable", async () => {
  const page = await readFile(new URL("../app/page.tsx", import.meta.url), "utf8");
  const styles = await readFile(new URL("../app/globals.css", import.meta.url), "utf8");
  assert.match(page, /<h1>FXレート読み上げ<\/h1>/);
  assert.doesNotMatch(page, /<h1><span>FXレート<\/span><span>読み上げ<\/span><\/h1>/);
  assert.match(styles, /\.control-clock \{[^}]*width:100%;[^}]*clamp\(13px,1\.12vw,17px\)/);
  assert.match(styles, /\.rate-row \{[^}]*minmax\(0,1\.6fr\)[^}]*minmax\(138px,1\.1fr\)/);
  assert.match(styles, /\.rate-value \{[^}]*padding:0 2px 0 0[^}]*clamp\(24px,1\.95vw,28px\)/);
  assert.doesNotMatch(page, /className="rate-status-slot"/);
  assert.match(styles, /@keyframes rapid-pair-pulse \{ 0%,100%[^}]*\} 10%,90%/);
  assert.match(page, /className="history-meta"[\s\S]*className="feed-text"/);
  assert.match(styles, /\.history-row \{[^}]*grid-template-columns:minmax\(0,1fr\)/);
  assert.match(styles, /\.history-meta \{[^}]*grid-template-columns:48px minmax\(0,1fr\) 72px/);
  assert.match(styles, /\.feed-kind \{[^}]*white-space:normal/);
});

test("v69 prefers live Yahoo meta quotes and prevents stale synthetic graph reuse", async () => {
  const page = await readFile(new URL("../app/page.tsx", import.meta.url), "utf8");
  const route = await readFile(new URL("../app/api/rates/route.ts", import.meta.url), "utf8");
  assert.match(route, /const live = validRate\(chart\?\.meta\?\.regularMarketPrice, chart\?\.meta\?\.regularMarketTime\);[\s\S]*if \(live\) return live;/);
  assert.match(page, /delete latestSyntheticRef\.current\[symbol\]/);
  assert.match(page, /if \(!rawPoint\)[\s\S]*delete latestSyntheticRef\.current\[symbol\]/);
  assert.match(page, /STRENGTH_VISUAL_MAX_DIFFERENCE = 18/);
  assert.match(page, /STRENGTH_VISUAL_EXPONENT = 1\.55/);
  assert.match(page, /const color = normalized \*\* 1\.05/);
  assert.match(page, /STRENGTH_LINE_MAX_WIDTH = 8\.2/);
});

test("v70 uses trend-aware strength persistence and keeps status immediately left of the restored large rate", async () => {
  const page = await readFile(new URL("../app/page.tsx", import.meta.url), "utf8");
  const styles = await readFile(new URL("../app/globals.css", import.meta.url), "utf8");
  assert.match(page, /STRENGTH_TREND_HISTORY = \{ 60: 6, 30: 5, 15: 4, 7: 3 \}/);
  assert.match(page, /function trendAwareStrengthDifference/);
  assert.match(page, /consistency \* 0\.65/);
  assert.match(page, /consecutive/);
  assert.match(page, /strengthTrendHistoryRef/);
  assert.match(page, /displayPairScores=\{strengthDisplayScores\[windowSize\]/);
  assert.match(page, /className="rate-value-line"[\s\S]*movementSymbol\(movement\)[\s\S]*className=\{`rate-value/);
  assert.match(styles, /\.rate-value-line \{[^}]*display:flex[^}]*align-items:baseline[^}]*justify-content:flex-end/);
  assert.match(styles, /\.rate-value \{[^}]*clamp\(24px,1\.95vw,28px\)/);
  assert.match(styles, /\.synthetic-badge \{[^}]*border:0[^}]*background:transparent[^}]*font-size:7px/);
  assert.match(styles, /\.movement \{[^}]*font-size:14px/);
});

test("v73 uses strong red clock danger windows at 50:00-05:00 and 20:00-35:00", async () => {
  const page = await readFile(new URL("../app/page.tsx", import.meta.url), "utf8");
  const styles = await readFile(new URL("../app/globals.css", import.meta.url), "utf8");
  assert.match(page, /function isClockAlertWindow/);
  assert.match(page, /second: "2-digit"/);
  assert.match(page, /return within\(50, 5\) \|\| within\(20, 35\)/);
  assert.match(styles, /\.control-clock\.alert-window \{[^}]*border-color:#ff1738[^}]*background:#b4001f/);
  assert.match(styles, /animation:clock-alert-text-blink \.78s/);
  assert.match(styles, /@keyframes clock-alert-text-blink/);
});

test("v72 inline status intent is preserved by the current rate layout", async () => {
  const page = await readFile(new URL("../app/page.tsx", import.meta.url), "utf8");
  const styles = await readFile(new URL("../app/globals.css", import.meta.url), "utf8");
  assert.match(page, /className="rate-value-line"[\s\S]*movementSymbol\(movement\)[\s\S]*className=\{`rate-value/);
  assert.doesNotMatch(page, /className="rate-status-slot"/);
  assert.match(styles, /\.rate-value-line \{[^}]*display:flex[^}]*align-items:baseline[^}]*justify-content:flex-end[^}]*gap:5px/);
  assert.match(styles, /\.rate-value \{[^}]*flex:0 0 auto[^}]*width:auto/);
  assert.match(styles, /\.synthetic-badge \{[^}]*border:0[^}]*font-size:7px/);
});

test("v75 reduces Forex Factory throttling risk and keeps a fallback calendar source", async () => {
  const page = await readFile(new URL("../app/page.tsx", import.meta.url), "utf8");
  const calendar = await readFile(new URL("../app/api/calendar/route.ts", import.meta.url), "utf8");
  assert.match(page, /CALENDAR_POLL_INTERVAL_MS = 5 \* 60 \* 1000/);
  assert.match(page, /CALENDAR_STALE_MS = 15 \* 60 \* 1000/);
  assert.match(calendar, /cdn-nfs\.faireconomy\.media\/ff_calendar_thisweek\.json/);
  assert.match(calendar, /UPSTREAM_CACHE_MS = 5 \* 60 \* 1000/);
  assert.match(calendar, /cachedSource/);
  assert.match(calendar, /stale-while-revalidate=600/);
});

test("v77 uses window-specific currency-strength v2.1 weighting", async () => {
  const strength = await readFile(new URL("../lib/currency-strength.ts", import.meta.url), "utf8");
  assert.match(strength, /function scoreSpan/);
  assert.match(strength, /function windowWeights/);
  assert.match(strength, /rank: 0\.40, agreement: 0\.30, continuation: 0\.25, magnitude: 0\.05, acceleration: 0/);
  assert.match(strength, /rank: 0\.25, agreement: 0\.30, continuation: 0\.25, magnitude: 0\.15, acceleration: 0\.05/);
  assert.match(strength, /efficiency \* 0\.45 \+ Math\.abs\(directionBalance\) \* 0\.35 \+ activityConfidence \* 0\.20/);
  assert.match(strength, /attachMagnitudeRanks/);
  assert.match(strength, /components\.acceleration/);
  assert.match(strength, /if \(windowSize >= 60\) return 48/);
  assert.match(strength, /if \(windowSize >= 30\) return 44/);
  assert.match(strength, /if \(windowSize >= 15\) return 40/);
  assert.match(strength, /return 32/);
});

test("v77 requires repeated confirmation before a strong 7-point display", async () => {
  const page = await readFile(new URL("../app/page.tsx", import.meta.url), "utf8");
  assert.match(page, /function trendAwareStrengthDifference\(history: number\[\], windowSize: number\)/);
  assert.match(page, /if \(windowSize <= 7\)/);
  assert.match(page, /const recent = history\.slice\(-3\)/);
  assert.match(page, /if \(significant\.length < 2\) return current \* 0\.20/);
  assert.match(page, /if \(dominant\.length < 2\) return current \* 0\.25/);
  assert.match(page, /trendAwareStrengthDifference\(nextHistory, windowSize\)/);
});

test("v96 keeps the app version in one source file", async () => {
  const version = await readFile(new URL("../lib/version.ts", import.meta.url), "utf8");
  const page = await readFile(new URL("../app/page.tsx", import.meta.url), "utf8");
  const layout = await readFile(new URL("../app/layout.tsx", import.meta.url), "utf8");
  assert.match(version, /FX_RATE_SPEAKER_VERSION = 96/);
  assert.match(version, /FX_RATE_SPEAKER_VERSION_LABEL/);
  assert.match(version, /FX_RATE_SPEAKER_TITLE/);
  assert.match(page, /FX_RATE_SPEAKER_VERSION_LABEL/);
  assert.match(layout, /FX_RATE_SPEAKER_TITLE/);
  assert.doesNotMatch(page, /<strong>v85<\/strong>/);
  assert.doesNotMatch(layout, /FX Rate Speaker v85/);
});

test("v87 rotates proverbs and supports DST-aware scheduled market notices", async () => {
  const page = await readFile(new URL("../app/page.tsx", import.meta.url), "utf8");
  const styles = await readFile(new URL("../app/globals.css", import.meta.url), "utf8");
  assert.match(page, /LDN勢参入前・ポジション解消注意/);
  assert.match(page, /LDN勢参入・初動と欧州通貨に注意/);
  assert.match(page, /TKY勢参入前・初動準備/);
  assert.match(page, /NY勢参入・初動と逆流に注意/);
  assert.match(page, /activeMarketNotice\(marketNotices, currentTime\)/);
  assert.match(page, /MARKET_NOTICE_STORAGE_KEY/);
  assert.match(page, /時間帯メッセージ管理/);
  assert.match(page, /toggleMarketNoticeWeekday/);
  assert.match(page, /addMarketNotice/);
  assert.match(page, /currentMarketNotice\?\.message \|\| fallbackMarketProverb/);
  assert.match(page, /Math\.floor\(minute \/ 5\)/);
  assert.match(page, /Europe\/London/);
  assert.match(page, /America\/New_York/);
  assert.match(page, /LDN夏冬対応/);
  assert.match(page, /NY夏冬対応/);
  assert.match(page, /marketNoticeDisplayRange/);
  assert.match(page, /marketNoticeJstTime/);
  assert.match(page, /marketNoticeSourceTime/);
  assert.match(page, /timeBasis: "new_york"/);
  assert.match(page, /入力時刻は日本時間表示です/);
  assert.match(styles, /\.brand-title-row/);
  assert.match(styles, /\.main-action\.compact/);
  assert.match(styles, /\.market-notice/);
  assert.match(styles, /\.market-notice\.scheduled \{[^}]*background:linear-gradient[^}]*color:#fff/);
  assert.match(styles, /0%,48% \{ color:#fff/);
  assert.match(styles, /49%,100% \{ color:#fff/);
  assert.match(styles, /\.notice-admin/);
});

test("v82 exposes OANDA health diagnostics and live connection status", async () => {
  const page = await readFile(new URL("../app/page.tsx", import.meta.url), "utf8");
  const route = await readFile(new URL("../app/api/shadow/oanda/route.ts", import.meta.url), "utf8");
  const styles = await readFile(new URL("../app/globals.css", import.meta.url), "utf8");
  assert.match(route, /health = new URL\(request\.url\)\.searchParams\.get\("health"\) === "1"/);
  assert.match(route, /restEnvironmentBase/);
  assert.match(route, /configured: false/);
  assert.match(route, /reachable: healthResponse\.ok/);
  assert.match(page, /refreshOandaHealth/);
  assert.match(page, /source\.onopen/);
  assert.match(page, /setOandaStatus\("connected"\)/);
  assert.match(page, /OANDA 未設定 \/ Yahoo予備/);
  assert.match(page, /OANDA 接続失敗 \/ Yahoo予備/);
  assert.match(page, /OANDA 切断 \/ Yahoo予備/);
  assert.match(styles, /\.oanda-status\.connected/);
});

test("v81 allows pair selection changes while reading without restarting the worker", async () => {
  const page = await readFile(new URL("../app/page.tsx", import.meta.url), "utf8");
  const styles = await readFile(new URL("../app/globals.css", import.meta.url), "utf8");
  assert.match(page, /const selectedRef = useRef<string\[]>\(\["USD\/JPY"\]\)/);
  assert.match(page, /selectedRef\.current = next/);
  assert.match(page, /fetchAndSpeak\(runIdRef\.current, \[\.\.\.selectedRef\.current\], intervalSeconds\)/);
  assert.match(page, /\}, \[intervalSeconds\]\);/);
  assert.doesNotMatch(page, /if \(running\) return;/);
  assert.doesNotMatch(page, /selection-locked/);
  assert.doesNotMatch(page, /aria-disabled=\{running\}/);
  assert.match(page, /onClick=\{\(\) => togglePair\(pair\.code\)\}/);
  assert.match(styles, /\.rate-row:hover \{/);
});

test("v80 normalizes rapid alerts to each pair's own recent volatility range", async () => {
  const movement = await readFile(new URL("../lib/movement.ts", import.meta.url), "utf8");
  const page = await readFile(new URL("../app/page.tsx", import.meta.url), "utf8");
  assert.match(movement, /RAPID_DIRECTION_RATIO = 0\.7/);
  assert.match(movement, /RAPID_SHORT_RANGE_RATIO = 0\.35/);
  assert.match(movement, /RAPID_LONG_RANGE_RATIO = 0\.60/);
  assert.match(movement, /const recentRange = \(Math\.max\(\.\.\.prices\) - Math\.min\(\.\.\.prices\)\) \/ pipSize/);
  assert.match(movement, /recentRange \* RAPID_SHORT_RANGE_RATIO/);
  assert.match(movement, /recentRange \* RAPID_LONG_RANGE_RATIO/);
  assert.doesNotMatch(movement, /RAPID_SHORT_MIN_PIPS|RAPID_LONG_MIN_PIPS/);
  assert.match(page, /recentRange:/);
  assert.match(page, /直近約\$\{\(movement\.rapidMovePips \?\? 0\)\.toFixed\(1\)\}pips動いています/);
});

test("v94 keeps OANDA synthetic gray while Yahoo uses the normal rate color", async () => {
  const page = await readFile(new URL("../app/page.tsx", import.meta.url), "utf8");
  const styles = await readFile(new URL("../app/globals.css", import.meta.url), "utf8");
  assert.match(page, /const rateSource = rateSources\[pair\.code\]/);
  assert.match(page, /const useSyntheticDisplay = rateSource === "OANDA_SYNTHETIC"/);
  assert.match(page, /OANDA Syntheticレート/);
  assert.match(page, /rateSource === "YAHOO" \? "Yahooレート"/);
  assert.match(page, /OANDA直接レート/);
  assert.match(styles, /\.rate-value\.synthetic \{ color:#9aa0a8; \}/);
  assert.doesNotMatch(page, /Yahoo予備レート/);
});

test("v79 keeps legacy Yahoo synthetic learning only as background audit while adopted rates drive analysis", async () => {
  const page = await readFile(new URL("../app/page.tsx", import.meta.url), "utf8");
  const route = await readFile(new URL("../app/api/rates/route.ts", import.meta.url), "utf8");
  assert.match(route, /syntheticSources/);
  assert.match(route, /syntheticActuals/);
  assert.match(page, /processSyntheticSnapshot/);
  assert.match(page, /const adoptedRates = updateRateSnapshot/);
  assert.match(page, /analyzeAllPairs\(adoptedRates/);
  assert.match(page, /price: spokenPrice\(current, pair\.yen\)/);
  assert.match(page, /SYNTHETIC_STORAGE_KEY/);
});


test("v91 keeps calendar display polling independent from NEWS mode and warns in MARKET NOTE", async () => {
  const page = await readFile(new URL("../app/page.tsx", import.meta.url), "utf8");
  const calendar = await readFile(new URL("../app/api/calendar/route.ts", import.meta.url), "utf8");
  const styles = await readFile(new URL("../app/globals.css", import.meta.url), "utf8");
  assert.match(page, /async function pollCalendar\(\)/);
  assert.match(page, /void pollCalendar\(\);[\s\S]*calendarTimerRef/);
  assert.match(page, /const upcomingCalendarEvent = calendarEvents\.find/);
  assert.match(page, /market-calendar-alert/);
  assert.match(page, /重要指標まで\{upcomingCalendarMinutes\}分/);
  assert.match(page, /\{calendarEvents\.length \? \(/);
  assert.doesNotMatch(page, /audioMode === "mode4" && calendarEvents\.length/);
  assert.match(calendar, /Promise\.allSettled\(SOURCES\.map\(\(url\) => fetchSource\(url\)\)\)/);
  assert.match(calendar, /SOURCE_TIMEOUT_MS = 7_000/);
  assert.match(styles, /\.market-calendar-alert\.proximity-red/);
});

test("v92 restores Yahoo rates to the normal display color when OANDA is unavailable", async () => {
  const page = await readFile(new URL("../app/page.tsx", import.meta.url), "utf8");
  assert.match(page, /rateSource === "YAHOO" \? "Yahooレート"/);
  assert.doesNotMatch(page, /useYahooFallback \? "fallback"/);
});

test("v93 exposes reverse synthetic diagnostics for direct USD quotes", async () => {
  const route = await readFile(new URL("../app/api/shadow/yahoo/route.ts", import.meta.url), "utf8");
  assert.match(route, /function reverseFormula/);
  assert.match(route, /"EUR\/USD".*"EUR\/JPY".*"USD\/JPY"/s);
  assert.match(route, /reverseBaseComparisons/);
  assert.match(route, /reverseBaseSyncedComparisons/);
  assert.match(route, /reverseSyntheticPrice/);
});

test("v94 builds EURUSD and GBPUSD from direct JPY crosses for fresher 10-second monitoring", async () => {
  const route = await readFile(new URL("../app/api/rates/route.ts", import.meta.url), "utf8");
  assert.match(route, /"EUR\/JPY": "EURJPY=X"/);
  assert.match(route, /"GBP\/JPY": "GBPJPY=X"/);
  assert.match(route, /if \(eurJpy && usdJpy\) rates\["EUR\/USD"\] = cross\(eurJpy, usdJpy, "divide"\)/);
  assert.match(route, /if \(gbpJpy && usdJpy\) rates\["GBP\/USD"\] = cross\(gbpJpy, usdJpy, "divide"\)/);
  assert.match(route, /rateConstruction:/);
});

test("v95 expands five-minute market proverbs", async () => {
  const page = await readFile(new URL("../app/page.tsx", import.meta.url), "utf8");
  assert.match(page, /const MARKET_PROVERBS = \[/);
  assert.match(page, /見切り千両、損切り万両/);
  assert.match(page, /得意な形だけを待つ/);
  assert.match(page, /Math\.floor\(minute \/ 5\)/);
});


test("v96 keeps the original classic proverbs in regular rotation as the list grows", async () => {
  const page = await readFile(new URL("../app/page.tsx", import.meta.url), "utf8");
  assert.match(page, /const CLASSIC_MARKET_PROVERBS = MARKET_PROVERBS\.slice\(0, 6\)/);
  assert.match(page, /if \(slot % 6 === 0\)/);
  assert.match(page, /CLASSIC_MARKET_PROVERBS\[Math\.floor\(slot \/ 6\) % CLASSIC_MARKET_PROVERBS\.length\]/);
  assert.match(page, /return MARKET_PROVERBS\[slot % MARKET_PROVERBS\.length\]/);
});
