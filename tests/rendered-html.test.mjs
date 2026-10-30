import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";

const developmentPreviewMeta =
  /<meta(?=[^>]*\bname=["']codex-preview["'])(?=[^>]*\bcontent=["']development["'])[^>]*>/i;

test("renders development preview metadata", async (t) => {
  const workerUrl = new URL("../dist/server/index.js", import.meta.url);
  workerUrl.searchParams.set("test", `${process.pid}-${Date.now()}`);
  let worker;
  try {
    ({ default: worker } = await import(workerUrl.href));
  } catch (error) {
    if (error?.code === "ERR_UNSUPPORTED_ESM_URL_SCHEME") {
      t.skip("Node cannot load the Cloudflare D1 runtime scheme used by the built Worker");
      return;
    }
    throw error;
  }

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
    developmentPreviewMeta.test(html) || /<title>FX Rate Speaker v143<\/title>/i.test(html),
    "rendered output should contain preview metadata or the current production title",
  );
});

test("v118 exposes only modes 4 and 5 while keeping the shared stable feature set", async () => {
  const source = await readFile(new URL("../app/page.tsx", import.meta.url), "utf8");
  assert.match(source, /type AudioMode = "mode4" \| "mode5"/);
  assert.match(source, /mode4: Object\.freeze\(\{ commentary: true, news: true, calendarAlerts: true, rapidCauses: true/);
  assert.match(source, /mode5: Object\.freeze\(\{ commentary: true, news: true, calendarAlerts: true, rapidCauses: true/);
  assert.match(source, /function audioModeFeatures\(mode: AudioMode\)/);
  assert.match(source, /function restoreAudioMode\(saved: string \| null\): AudioMode \{[\s\S]*saved === "mode5" \? "mode5" : "mode4"/);
  assert.match(source, /type NewsLevel = "NEWS_L1" \| "NEWS_L2" \| "NEWS_L3"/);
  assert.match(source, /PRICE_RAPID: 60,[\s\S]*NEWS_L3: 50,[\s\S]*NEWS_L2: 40,[\s\S]*NEWS_L1: 30/);
  assert.match(source, /async function playNewsAlert/);
  assert.match(source, /async function playCommentaryAlert/);
  assert.match(source, /\[987\.77, 1975\.54\][\s\S]*\[659\.25, 1318\.5\]/);
  assert.match(source, /commentary\.source === "NEWS"[\s\S]*"PRICE_RAPID"/);
  assert.match(source, /<strong>\{FX_RATE_SPEAKER_VERSION_LABEL\}<\/strong>/);
  assert.match(source, /applyAudioMode\("mode4"\)\}>4<\/button>/);
  assert.match(source, /applyAudioMode\("mode5"\)\}>5<\/button>/);
  assert.doesNotMatch(source, /applyAudioMode\("mode2"\)|applyAudioMode\("mode3"\)/);
  assert.match(source, /window\.localStorage\.setItem\(AUDIO_MODE_STORAGE_KEY, next\)/);
  assert.match(source, /const restored = restoreAudioMode\(saved\)/);
  assert.match(source, /audioModeFeatures\(audioModeRef\.current\)\.news/);
  assert.match(source, /NEWS_POLL_INTERVAL_MS = 60 \* 1000/);
  assert.match(source, /item\.level !== "NEWS_L1"/);
  assert.doesNotMatch(source, /function movementSymbol|function movementLabel/);
});

test("v113 defaults safely to mode 4 and renders clickable 30-point retained-history sparklines", async () => {
  const source = await readFile(new URL("../app/page.tsx", import.meta.url), "utf8");
  const styles = await readFile(new URL("../app/globals.css", import.meta.url), "utf8");
  assert.match(source, /useState<AudioMode>\("mode4"\)/);
  assert.match(source, /return saved === "mode5" \? "mode5" : "mode4"/);
  assert.match(source, /function Sparkline/);
  assert.match(source, /SPARKLINE_DISPLAY_POINT_COUNT = 30/);
  assert.match(source, /SPARKLINE_HISTORY_POINT_COUNT = 190/);
  assert.match(source, /SPARKLINE_MID_WINDOW = 15/);
  assert.match(source, /SPARKLINE_RECENT_WINDOW = MODE2_POINT_COUNT/);
  assert.match(source, /appendSparklinePoint\(nextSparklineHistories\[pair\.code\]/);
  assert.match(source, /const directionWindows = \[60, 15, 5, 1\]/);
  assert.match(source, /pairPeriodDirection\(directionHistory, windowMinutes\)/);
  assert.match(source, /const useSyntheticDisplay = rateSource === "OANDA_SYNTHETIC"/);
  assert.match(source, /rate-value \$\{useSyntheticDisplay \? "synthetic"/);
  assert.match(styles, /grid-template-columns:minmax\(240px,25fr\) minmax\(500px,38fr\) minmax\(390px,37fr\)/);
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
  assert.doesNotMatch(source, /movement !== "NORMAL"/);
  assert.doesNotMatch(source, /aria-label="読み上げ速度"/);
  assert.match(source, /BREAKOUT_LOOKBACK_SECONDS = 15 \* 60/);
  assert.match(source, /BREAKOUT_RANGE_RATIO = 0\.04/);
  assert.match(source, /BREAKOUT_MIN_PIPS = 0\.5/);
  assert.match(source, /flowCommentary\(name, flow, movement\.state/);
  assert.doesNotMatch(source, /MEMO_STORAGE_KEY|<textarea value=\{memo\}/);
});

test("v120 keeps mode 4 stable and routes complete mode 5 events through one queue", async () => {
  const page = await readFile(new URL("../app/page.tsx", import.meta.url), "utf8");
  const styles = await readFile(new URL("../app/globals.css", import.meta.url), "utf8");
  assert.match(page, /mode4: Object\.freeze\(\{[^}]*timeWindowAudio: false[^}]*timeWindowRapid: false[^}]*thirtyMinuteGraph: false/);
  assert.match(page, /mode5: Object\.freeze\(\{[^}]*timeWindowAudio: true[^}]*timeWindowRapid: true[^}]*thirtyMinuteGraph: true/);
  assert.match(page, /buildMode5ToneCues/);
  assert.match(page, /playMode5TimeWindowTone/);
  assert.match(page, /playMode5RapidWarning/);
  assert.doesNotMatch(page, /mode5SkipDirectionToneRef/);
  assert.match(page, /enqueueMode5AudioEvent/);
  assert.match(page, /queueMode5RapidAudioEvent/);
  assert.doesNotMatch(page, /void playMode5RapidWarning\(movement\.notification/);
  assert.match(page, /Mode 5 is self-contained:[\s\S]*never fall back to the legacy seven-point melody/);
  assert.match(page, /analyzeMode5Rapid/);
  assert.match(page, /sampleThirtyMinuteGraph/);
  assert.match(page, /threeMinuteGridLines/);
  assert.match(styles, /\.spark-time-grid\.minor/);
  assert.match(styles, /\.spark-time-grid\.major/);
  assert.doesNotMatch(styles, /\.spark-time-grid\.(?:minor|major)[^{]*\{[^}]*stroke-dasharray/);
  assert.match(page, /const y = 28\.5 - \(\(price - minimum\) \/ spread\) \* 27/);
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
  const policy = await readFile(new URL("../lib/adopted-rates.ts", import.meta.url), "utf8");
  assert.match(source, /selectAdoptedRates\(oandaLiveRef.current, yahooRates\)/);
  assert.match(policy, /function freshOandaRate/);
  assert.match(policy, /function syntheticOandaRate/);
  assert.match(policy, /direct \? "OANDA" : synthetic \? "OANDA_SYNTHETIC" : "YAHOO"/);
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
  assert.match(source, /mof\.go\.jp\/english\/news\.rss/);
  assert.match(source, /UPSTREAM_CACHE_MS = 60 \* 1000/);
  assert.match(source, /Promise\.allSettled/);
  assert.match(source, /NEWS_L1/);
  assert.match(source, /NEWS_L2/);
  assert.match(source, /NEWS_L3/);
});

test("v111 classifies RAPID causes without future-news leakage", async () => {
  const page = await readFile(new URL("../app/page.tsx", import.meta.url), "utf8");
  const intelligence = await readFile(new URL("../lib/news-intelligence.ts", import.meta.url), "utf8");
  assert.match(page, /findRapidCause\(pair\.code, now, recentNewsRef\.current, calendarEventsRef\.current\)/);
  assert.match(page, /source: "CAUSE"/);
  assert.match(page, /CAUSE \$\{cause\.confidence\}/);
  assert.match(intelligence, /timestamp <= detectedAt/);
  assert.match(intelligence, /CAUSE_LOOKBACK_MS = 15 \* 60 \* 1000/);
  assert.match(intelligence, /"CONFIRMED" \| "LIKELY" \| "UNKNOWN"/);
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
  assert.match(page, /label=\{String\(windowMinutes\)\}/);
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
  assert.doesNotMatch(page, /RAPID_UP"\) return "↑↑"|RAPID_DOWN"\) return "↓↓"/);
  assert.match(page, /ready=\{ready\}/);
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
  assert.match(strength, /CURRENCY_STRENGTH_WINDOWS = \[60, 15, 5, 1\]/);
  assert.match(strength, /STRENGTH_VERTEX_ORDER = \["USD", "JPY", "AUD", "GBP", "EUR"\]/);
  assert.match(strength, /Math\.log\(point\.price\)/);
  assert.match(strength, /rank: 0\.30, agreement: 0\.30, continuation: 0\.25, magnitude: 0\.10/);
  assert.match(strength, /componentTotals\[base\]\.agreement \+= signedQuality;[\s\S]*componentTotals\[quote\]\.agreement -= signedQuality/);
  assert.match(strength, /usedPairs < STRENGTH_PAIR_CODES\.length/);
  assert.match(strength, /clamp\(50 \+ composite \* scoreSpan\(windowMinutes\), 0, 100\)/);
  assert.match(page, /STRENGTH_PAIR_CODES\.map[\s\S]*data-pair=\{pairCode\}/);
  assert.match(page, /<linearGradient[\s\S]*stopColor=\{baseColor\}[\s\S]*stopColor=\{quoteColor\}/);
  assert.doesNotMatch(page, /magnitude < 6|magnitude >= 18/);
  assert.match(page, /STRENGTH_VISUAL_EXPONENT = 1\.55/);
  assert.match(page, /normalized \*\* STRENGTH_VISUAL_EXPONENT/);
  assert.match(page, /strokeWidth=\{mapping\.width\}/);
  assert.match(page, /className="strength-guide-line"/);
  assert.doesNotMatch(page, /className="radar-value"/);
  assert.match(page, /<StrengthPentagon[\s\S]*key=\{windowMinutes\}[\s\S]*displayPairScores=/);
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
  assert.match(styles, /\.rate-row \{[^}]*minmax\(94px,\.68fr\)[^}]*minmax\(124px,1\.82fr\)[^}]*minmax\(122px,\.88fr\)[^}]*minmax\(70px,\.54fr\)/);
  assert.match(styles, /\.rate-value \{[^}]*padding:0 2px 0 0[^}]*clamp\(24px,1\.95vw,28px\)/);
  assert.doesNotMatch(page, /className="rate-status-slot"/);
  assert.match(styles, /@keyframes pair-pill-rapid-up/);
  assert.match(styles, /@keyframes pair-pill-rapid-down/);
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
  assert.match(page, /STRENGTH_TREND_HISTORY = \{ 60: 6, 15: 4, 5: 3, 1: 3 \}/);
  assert.match(page, /function trendAwareStrengthDifference/);
  assert.match(page, /consistency \* 0\.65/);
  assert.match(page, /consecutive/);
  assert.match(page, /strengthTrendHistoryRef/);
  assert.match(page, /displayPairScores=\{strengthDisplayScores\[windowMinutes\]/);
  assert.doesNotMatch(page, /movementSymbol\(movement\)|className="movement/);
  assert.match(styles, /\.rate-value-line \{[^}]*display:flex[^}]*align-items:baseline[^}]*justify-content:flex-end/);
  assert.match(styles, /\.rate-value \{[^}]*clamp\(24px,1\.95vw,28px\)/);
  assert.match(styles, /\.synthetic-badge \{[^}]*border:0[^}]*background:transparent[^}]*font-size:7px/);
  assert.doesNotMatch(styles, /\.movement \{/);
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
  assert.doesNotMatch(page, /movementSymbol\(movement\)|className="movement/);
  assert.doesNotMatch(page, /className="rate-status-slot"/);
  assert.match(styles, /\.rate-value-line \{[^}]*display:flex[^}]*align-items:baseline[^}]*justify-content:flex-end[^}]*gap:2px/);
  assert.match(styles, /\.rate-value \{[^}]*flex:0 0 auto[^}]*width:auto/);
  assert.match(styles, /\.synthetic-badge \{[^}]*border:0[^}]*font-size:7px/);
});

test("v111 shares the calendar cache at the current one-minute bulletin interval", async () => {
  const page = await readFile(new URL("../app/page.tsx", import.meta.url), "utf8");
  const calendar = await readFile(new URL("../app/api/calendar/route.ts", import.meta.url), "utf8");
  assert.match(page, /CALENDAR_POLL_INTERVAL_MS = 60 \* 1000/);
  assert.match(page, /CALENDAR_STALE_MS = 15 \* 60 \* 1000/);
  assert.match(calendar, /cdn-nfs\.faireconomy\.media\/ff_calendar_thisweek\.json/);
  assert.match(calendar, /UPSTREAM_CACHE_MS = 60 \* 1000/);
  assert.match(calendar, /cachedSource/);
  assert.match(calendar, /stale-while-revalidate=180/);
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
  assert.match(strength, /if \(windowMinutes >= 60\) return 48/);
  assert.match(strength, /if \(windowMinutes >= 15\) return 40/);
  assert.match(strength, /if \(windowMinutes >= 5\) return 36/);
  assert.match(strength, /return 32/);
});

test("v109 keeps repeated confirmation for short time-window display", async () => {
  const page = await readFile(new URL("../app/page.tsx", import.meta.url), "utf8");
  assert.match(page, /function trendAwareStrengthDifference\(history: number\[\], windowSize: number\)/);
  assert.match(page, /if \(windowSize <= 7\)/);
  assert.match(page, /const recent = history\.slice\(-3\)/);
  assert.match(page, /if \(significant\.length < 2\) return current \* 0\.20/);
  assert.match(page, /if \(dominant\.length < 2\) return current \* 0\.25/);
  assert.match(page, /trendAwareStrengthDifference\(nextHistory, windowMinutes\)/);
});

test("v114 stores compact positions and appends their P/L speech in both audio modes", async () => {
  const page = await readFile(new URL("../app/page.tsx", import.meta.url), "utf8");
  const styles = await readFile(new URL("../app/globals.css", import.meta.url), "utf8");
  assert.match(page, /POSITIONS_STORAGE_KEY = "fx-rate-speaker-positions-v1"/);
  assert.match(page, /const \[positions, setPositions\] = useState<PositionMap>/);
  assert.match(page, /restorePositions\([\s\S]*window\.localStorage\.getItem\(POSITIONS_STORAGE_KEY\)/);
  assert.match(page, /window\.localStorage\.setItem\(POSITIONS_STORAGE_KEY, JSON\.stringify\(next\)\)/);
  assert.match(page, /positionSpeech: positionsRef\.current\[code\]/);
  assert.match(page, /if \(item\.positionSpeech\) \{[\s\S]*playMode5PositionCue\(runId\)[\s\S]*playSpeech\(item\.positionSpeech, runId\)/);
  assert.match(page, /className=\{`position-entry/);
  assert.match(page, /persistSelection\(\[positionEditor\.pair\]\)/);
  assert.match(page, /persistSelection\(\[state\.pair\]\)/);
  assert.match(page, /persistPositions\(\{\}\);[\s\S]*persistSelection\(\[\]\)/);
  assert.match(page, /setInterval\(\(\) => \{ void loadSharedSelection\(\); \}, 3000\)/);
  assert.match(page, /type="text" inputMode="decimal"/);
  assert.match(page, /className="position-entry-display"/);
  assert.match(page, /adjustAutoStopHours\(-1\)/);
  assert.match(page, /adjustAutoStopHours\(1\)/);
  assert.match(page, /className=\{`position-pips/);
  assert.match(page, />解除<\/button>/);
  assert.match(styles, /\.position-pips \{/);
  assert.match(styles, /\.position-pips\.profit \{ color:#72e6a3/);
  assert.match(styles, /\.position-pips\.loss \{ color:#ff7e8d/);
  assert.match(page, /mode4: Object\.freeze\([\s\S]*mode5: Object\.freeze/);
});

test("v121 registers authenticated expiring Shijin analysis and reuses the news audio queue", async () => {
  const page = await readFile(new URL("../app/page.tsx", import.meta.url), "utf8");
  const route = await readFile(new URL("../app/api/news/route.ts", import.meta.url), "utf8");
  const schema = await readFile(new URL("../db/schema.ts", import.meta.url), "utf8");
  assert.match(page, /MARKET NAVIGATION SOURCE/);
  assert.match(page, /manualAnalysis/);
  assert.match(page, /pendingNewsRef\.current/);
  assert.match(route, /requireAnalysisAdmin/);
  assert.match(route, /FXRS_ADMIN_EMAILS/);
  assert.match(route, /expires_at > \?/);
  assert.match(route, /dedupe_key/);
  assert.match(schema, /uniqueIndex\("market_analyses_dedupe_key_unique"\)/);
});

test("v118 keeps the app version in one source file", async () => {
  const version = await readFile(new URL("../lib/version.ts", import.meta.url), "utf8");
  const page = await readFile(new URL("../app/page.tsx", import.meta.url), "utf8");
  const layout = await readFile(new URL("../app/layout.tsx", import.meta.url), "utf8");
  assert.match(version, /FX_RATE_SPEAKER_VERSION = 143/);
  assert.match(version, /FX_RATE_SPEAKER_VERSION_LABEL/);
  assert.match(version, /FX_RATE_SPEAKER_TITLE/);
  assert.match(page, /FX_RATE_SPEAKER_VERSION_LABEL/);
  assert.match(layout, /FX_RATE_SPEAKER_TITLE/);
  assert.doesNotMatch(page, /<strong>v85<\/strong>/);
  assert.doesNotMatch(layout, /FX Rate Speaker v85/);
});

test("v112 restores readable TREND backgrounds without panel flashing", async () => {
  const styles = await readFile(new URL("../app/globals.css", import.meta.url), "utf8");
  assert.match(styles, /\.rate-row\.state-up_trend \{ background:linear-gradient\(145deg,#205a3b/);
  assert.match(styles, /\.rate-row\.state-down_trend \{ background:linear-gradient\(145deg,#642733/);
  assert.match(styles, /\.rate-row\.state-rapid_up \{ background:linear-gradient\(145deg,#205a3b/);
  assert.match(styles, /\.rate-row\.state-rapid_down \{ background:linear-gradient\(145deg,#642733/);
  assert.match(styles, /\.rate-row\.state-rapid_up \.pair-pill > span \{ animation:pair-pill-rapid-up/);
  assert.match(styles, /\.volatility-badge\.v4,\.volatility-badge\.v5 \{ animation:volatility-badge-flash/);
  assert.doesNotMatch(styles, /rapid-up-panel-flash|rapid-down-panel-flash/);
});

test("v109 uses real-time strength windows and one-minute startup backfill", async () => {
  const page = await readFile(new URL("../app/page.tsx", import.meta.url), "utf8");
  const strength = await readFile(new URL("../lib/currency-strength.ts", import.meta.url), "utf8");
  const historyRoute = await readFile(new URL("../app/api/rates/history/route.ts", import.meta.url), "utf8");
  assert.match(strength, /targetTimestamp = latest\.timestamp - windowMinutes \* 60/);
  assert.match(strength, /closestDistance > STRENGTH_TARGET_TOLERANCE_SECONDS/);
  assert.match(page, /calculateCurrencyStrength\(strengthHistories, windowMinutes\)/);
  assert.match(page, /STRENGTH_HISTORY_STORAGE_KEY/);
  assert.match(page, /hasFullStrengthCoverage/);
  assert.match(page, /fetch\(`\/api\/rates\/history\?t=/);
  assert.match(page, /historicalLast[\s\S]*liveFirst[\s\S]*ratio/);
  assert.match(page, /<strong>\{label\}m<\/strong>/);
  assert.match(historyRoute, /interval=1m&range=1d/);
  assert.match(historyRoute, /derivedRates/);
  assert.match(historyRoute, /points\.slice\(-70\)/);
});

test("v101 resets all short-term analysis history when a new run starts", async () => {
  const page = await readFile(new URL("../app/page.tsx", import.meta.url), "utf8");
  assert.match(page, /function resetSessionAnalysisHistory\(\)/);
  assert.match(page, /sparklineHistoriesRef\.current = \{\};/);
  assert.match(page, /setSparklineHistories\(\{\}\);/);
  assert.match(page, /setRateDisplayStates\(\{\}\);/);
  assert.match(page, /previousStrengthScoresRef\.current = \{\};/);
  assert.match(page, /strengthTrendHistoryRef\.current = \{\};/);
  assert.match(page, /setStrengthDisplayScores\(\{\}\);/);
  assert.match(page, /async function start\(\)[\s\S]*resetSessionAnalysisHistory\(\);[\s\S]*graphStart/);
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
  assert.doesNotMatch(page, /OANDA 未設定 \/ Yahoo予備|OANDA優先・Yahoo予備|傾向・急変は採用レート/);
  assert.match(styles, /\.oanda-status\.connected/);
});

test("v81 allows pair selection changes while reading without restarting the worker", async () => {
  const page = await readFile(new URL("../app/page.tsx", import.meta.url), "utf8");
  const styles = await readFile(new URL("../app/globals.css", import.meta.url), "utf8");
  assert.match(page, /const selectedRef = useRef<string\[]>\(\["USD\/JPY"\]\)/);
  assert.match(page, /selectedRef\.current = clean/);
  assert.match(page, /fetchAndSpeak\(runIdRef\.current, \[\.\.\.selectedRef\.current\], intervalSeconds\)/);
  assert.match(page, /\}, \[intervalSeconds\]\);/);
  assert.doesNotMatch(page, /if \(running\) return;/);
  assert.doesNotMatch(page, /selection-locked/);
  assert.doesNotMatch(page, /aria-disabled=\{running\}/);
  assert.match(page, /onClick=\{\(\) => togglePair\(pair\.code\)\}/);
  assert.match(styles, /\.rate-row:hover \{/);
});

test("v105 separates rapid acceleration from sustained trends", async () => {
  const movement = await readFile(new URL("../lib/movement.ts", import.meta.url), "utf8");
  const page = await readFile(new URL("../app/page.tsx", import.meta.url), "utf8");
  assert.match(movement, /RAPID_DIRECTION_EFFICIENCY = 0\.72/);
  assert.match(movement, /RAPID_DIRECTION_COUNT = 4/);
  assert.match(movement, /VOLATILITY_WINDOW = 60/);
  assert.match(movement, /MIN_VOLATILITY_SAMPLES = 30/);
  assert.match(movement, /RAPID_FIVE_WINDOW_MULTIPLIER = 2\.5/);
  assert.match(movement, /RAPID_ACCELERATION_MULTIPLIER = 1\.5/);
  assert.match(movement, /RAPID_NOTIFICATION_COOLDOWN_MS = 90 \* 1000/);
  assert.match(movement, /historicalMovementDistribution/);
  assert.match(movement, /const netMagnitude = Math\.abs\(short\.netPips\)/);
  assert.match(movement, /netMagnitude \+ PIP_COMPARISON_EPSILON >= thresholds\.rapidShort/);
  assert.match(movement, /recentAccelerationAverage \/ precedingAverage/);
  assert.match(movement, /median\(moves\)/);
  assert.doesNotMatch(movement, /RAPID_SHORT_MIN_PIPS|RAPID_LONG_MIN_PIPS|RAPID_SHORT_RANGE_RATIO|RAPID_LONG_RANGE_RATIO|rapidLongUp|rapidLongDown/);
  assert.match(page, /recentRange:/);
  assert.match(page, /movement\.notification === "RAPID_UP" \? "急騰。" : "急落。"/);
  assert.match(page, /rising \? "上昇傾向。" : "下落傾向。"/);
});

test("v108 requires a material five-change move and audits rapid direction", async () => {
  const movement = await readFile(new URL("../lib/movement.ts", import.meta.url), "utf8");
  const page = await readFile(new URL("../app/page.tsx", import.meta.url), "utf8");
  assert.match(movement, /RAPID_FIVE_WINDOW_PERCENTILE = 0\.95/);
  assert.match(movement, /RAPID_ABSOLUTE_MOVE_PERCENTILE = 0\.90/);
  assert.match(movement, /RAPID_RANGE_RATIO = 0\.15/);
  assert.match(movement, /thresholds\.percentile95FiveMove/);
  assert.match(movement, /thresholds\.absoluteMove90 \* RAPID_SHORT_WINDOW/);
  assert.match(movement, /thresholds\.rangeMinimum/);
  assert.match(page, /\[FX Rate Speaker RAPID audit\]/);
  assert.match(page, /\[FX Rate Speaker RAPID direction mismatch\]/);
  assert.match(page, /latestPrice > analysis\.startPrice/);
  assert.match(page, /latestPrice < analysis\.startPrice/);
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

test("v97 updates displayed rates on every acquired value and adds compact recent-rate metrics", async () => {
  const page = await readFile(new URL("../app/page.tsx", import.meta.url), "utf8");
  const styles = await readFile(new URL("../app/globals.css", import.meta.url), "utf8");
  assert.match(page, /function recordOandaPrimary[\s\S]*applyAdoptedRates\(yahooRatesRef\.current\)/);
  assert.match(page, /const adoptedRates = updateRateSnapshot\(data\.rates/);
  assert.match(page, /const recentPastRates = previousGraphGridRates\(history, currentTime\)/);
  assert.match(page, /function normalizedPipValue/);
  assert.match(page, /100_000 \* 25/);
  assert.match(page, /className="rate-history-stats"/);
  assert.match(styles, /\.rate-history-stats \{/);
  assert.match(styles, /minmax\(500px,38fr\) minmax\(390px,37fr\)/);
});

test("v98 enlarges the final three digits and keeps only the color-coded NP value", async () => {
  const page = await readFile(new URL("../app/page.tsx", import.meta.url), "utf8");
  const styles = await readFile(new URL("../app/globals.css", import.meta.url), "utf8");
  assert.match(page, /function lastThreeRateDigits/);
  assert.match(page, /className="np-value"/);
  assert.doesNotMatch(page, /function atrLikePips/);
  assert.doesNotMatch(page, />ATR <strong>/);
  assert.doesNotMatch(page, />NP <strong>/);
  assert.match(styles, /\.history-digit \{[^}]*color:#e1dbc9/);
  assert.match(styles, /\.np-value \{[^}]*color:#72d7ff/);
  assert.match(styles, /\.rate-value-line \{[^}]*gap:2px/);
  assert.doesNotMatch(styles, /\.movement \{/);
});

test("v99 arranges the three previous rates and NP in a clipped two-by-two grid", async () => {
  const page = await readFile(new URL("../app/page.tsx", import.meta.url), "utf8");
  const styles = await readFile(new URL("../app/globals.css", import.meta.url), "utf8");
  assert.match(page, /className="history-digit"/);
  assert.match(styles, /\.rate-history-stats \{[^}]*grid-template-columns:repeat\(2,minmax\(0,1fr\)\)[^}]*grid-template-rows:repeat\(2,minmax\(0,1fr\)\)[^}]*overflow:hidden/);
  assert.match(styles, /\.history-digit,\.np-value \{[^}]*max-width:100%[^}]*font:900 14px\/1[^}]*overflow:hidden/);
});

test("v100 selects the three exact completed ten-second grid slots", async () => {
  const page = await readFile(new URL("../app/page.tsx", import.meta.url), "utf8");
  assert.match(page, /function previousGraphGridRates/);
  assert.match(page, /currentGridTimestamp = Math\.floor\(now \/ GRAPH_RATE_POLL_MS\) \* gridSeconds/);
  assert.match(page, /\[1, 2, 3\]\.map\(\(stepsBack\) => pointsByTimestamp\.get\(currentGridTimestamp - gridSeconds \* stepsBack\)\)/);
  assert.doesNotMatch(page, /history\.slice\(-4, -1\)\.reverse\(\)/);
});

test("v104 localizes rapid and volatility alerts and adds market volatility", async () => {
  const page = await readFile(new URL("../app/page.tsx", import.meta.url), "utf8");
  const styles = await readFile(new URL("../app/globals.css", import.meta.url), "utf8");
  assert.match(page, /USD: "#A855F7"/);
  assert.match(page, /JPY: "#FF4444"/);
  assert.match(page, /EUR: "#3B82F6"/);
  assert.match(page, /GBP: "#22C55E"/);
  assert.match(page, /AUD: "#F59E0B"/);
  assert.match(page, /function PairPill/);
  assert.match(page, /<PairPill code=\{pair\.code\} \/>/);
  assert.match(page, /strength-currency-pill/);
  assert.doesNotMatch(page, /function movementSymbol|className="movement/);
  assert.doesNotMatch(styles, /\.movement \{/);
  assert.match(styles, /\.pair-pill > span \{[^}]*font-size:11px/);
  assert.match(styles, /\.strength-pentagon text \{[^}]*font-size:7\.7px/);
  assert.match(styles, /\.sparkline \{[^}]*height:40px/);
  assert.match(styles, /\.rate-row\.state-up_trend \{[^}]*background:/);
  assert.match(styles, /\.rate-row\.state-down_trend \{[^}]*background:/);
  assert.match(styles, /\.rate-row\.state-rapid_up \.pair-pill > span \{ animation:pair-pill-rapid-up/);
  assert.match(styles, /\.rate-row\.state-rapid_down \.pair-pill > span \{ animation:pair-pill-rapid-down/);
  assert.match(styles, /\.volatility-badge\.v4,\.volatility-badge\.v5 \{ animation:volatility-badge-flash/);
  assert.doesNotMatch(styles, /volatility-panel-flash|rapid-up-panel-flash|rapid-down-panel-flash/);
  assert.match(page, /function marketVolatilityLevel/);
  assert.match(page, /MARKET_VOLATILITY_WEIGHTS/);
  assert.match(page, /majorHighCount >= MARKET_VOLATILITY_THRESHOLDS\.level5MajorPairs/);
  assert.match(page, /market-volatility market-v\$\{marketVolatility\}/);
  assert.match(page, /function strongStrengthCurrencies/);
  assert.match(page, /strengthVisual\(difference\)\.normalized < 1/);
  assert.match(page, /strongCurrencies\.has\(currency\) \? "strong-currency"/);
  assert.doesNotMatch(page, /rapidCurrencies=\{rapidCurrencies\}|function StrengthPentagon\([^)]*rapidCurrencies/);
  assert.match(styles, /\.strength-currency-pill\.strong-currency rect \{ animation:strength-pill-strong-flash/);
  assert.doesNotMatch(page, /className="source-note"/);
  assert.match(styles, /@media \(prefers-reduced-motion:reduce\)/);
});
