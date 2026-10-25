export type AnalysisSourceType = "SHISHIN" | "YOUTUBE" | "OTHER";
export type AnalysisStance = "BUY" | "SELL" | "WAIT";
export type SignalTrigger = "APPROACH" | "CROSS_ABOVE" | "CROSS_BELOW" | "REBOUND" | "REJECTION";
export type PriceRole = "CURRENT" | "ENTRY" | "TARGET" | "TAKE_PROFIT" | "STOP_LOSS" | "INVALIDATION" | "SUPPORT" | "RESISTANCE" | "WATCH";
export type MarketEnvironment = "UP" | "DOWN" | "RANGE" | "UNKNOWN";

export type ExtractedAnalysisSignal = {
  pair: string;
  stance: AnalysisStance;
  environment: MarketEnvironment;
  priceRole: PriceRole;
  levelLow: number;
  levelHigh: number;
  trigger: SignalTrigger;
  conditionText: string;
  invalidationText: string;
  sourceExcerpt: string;
  message: string;
};

const PAIR_ALIASES: Array<[string, RegExp]> = [
  ["USD/JPY", /ドル円|USD\s*\/?\s*JPY/i],
  ["EUR/USD", /ユーロドル|EUR\s*\/?\s*USD/i],
  ["GBP/USD", /ポンドドル|GBP\s*\/?\s*USD/i],
  ["AUD/USD", /(?:豪ドル米ドル|オージードル)|AUD\s*\/?\s*USD/i],
  ["EUR/JPY", /ユーロ円|EUR\s*\/?\s*JPY/i],
  ["GBP/JPY", /ポンド円|GBP\s*\/?\s*JPY/i],
  ["AUD/JPY", /(?:豪ドル円|オージー円)|AUD\s*\/?\s*JPY/i],
  ["EUR/GBP", /ユーロポンド|EUR\s*\/?\s*GBP/i],
  ["EUR/AUD", /(?:ユーロ豪ドル|ユーロオージー)|EUR\s*\/?\s*AUD/i],
  ["GBP/AUD", /(?:ポンド豪ドル|ポンドオージー)|GBP\s*\/?\s*AUD/i],
];

const SOURCE_LABELS: Record<AnalysisSourceType, string> = {
  SHISHIN: "四神",
  YOUTUBE: "動画分析",
  OTHER: "相場分析",
};

function compact(value: string, maximum = 120) {
  const normalized = value.replace(/^[#>*\-・\s]+/, "").replace(/\s+/g, " ").trim();
  return normalized.length <= maximum ? normalized : `${normalized.slice(0, maximum - 1)}…`;
}

function pairFor(sentence: string, fallback: string) {
  return PAIR_ALIASES.find(([, pattern]) => pattern.test(sentence))?.[0] ?? fallback;
}

function stanceFor(text: string): AnalysisStance {
  if (/戻り売り|売り(?:候補|優勢|目線)|SELL|ショート/i.test(text)) return "SELL";
  if (/押し目買い|買い(?:候補|優勢|目線)|BUY|ロング/i.test(text)) return "BUY";
  return "WAIT";
}

function environmentFor(text: string): MarketEnvironment {
  if (/レンジ|持ち合い|横ばい/.test(text)) return "RANGE";
  if (/下降|下落|弱い|弱さ|売り優勢/.test(text)) return "DOWN";
  if (/上昇|強い|強さ|買い優勢/.test(text)) return "UP";
  return "UNKNOWN";
}

function roleFor(text: string): PriceRole {
  if (/現在値|現値|最終値|終値/.test(text)) return "CURRENT";
  if (/失効|無効|シナリオ.*崩/.test(text)) return "INVALIDATION";
  if (/損切り|ストップ|撤退/.test(text)) return "STOP_LOSS";
  if (/利確/.test(text)) return "TAKE_PROFIT";
  if (/目標|ターゲット/.test(text)) return "TARGET";
  if (/エントリー|売りを待つ|買いを待つ|戻り売り候補|押し目買い候補/.test(text)) return "ENTRY";
  if (/上値抵抗|抵抗帯|レジスタンス/.test(text)) return "RESISTANCE";
  if (/下値支持|支持帯|サポート/.test(text)) return "SUPPORT";
  return "WATCH";
}

function plausiblePrice(pair: string, value: number) {
  if (!Number.isFinite(value) || value <= 0) return false;
  return pair.endsWith("/JPY") ? value >= 50 && value <= 400 : value >= 0.3 && value <= 4;
}

function explicitPrices(sentence: string, pair: string) {
  const normalized = sentence.replace(/,/g, "");
  const values: number[] = [];
  for (const match of normalized.matchAll(/(?<![\d.])(\d{1,3}(?:\.\d{1,5})?)(?![\d.])/g)) {
    const suffix = normalized.slice((match.index ?? 0) + match[0].length, (match.index ?? 0) + match[0].length + 5);
    if (/^(?:時|分|秒|年|月|日|％|%|pips?|ピップ)/i.test(suffix)) continue;
    const value = Number(match[1]);
    if (plausiblePrice(pair, value) && !values.includes(value)) values.push(value);
  }
  return values.slice(0, 2).sort((left, right) => left - right);
}

function triggerFor(sentence: string): SignalTrigger {
  if (/上抜け|上に抜け|超え(?:る|た|れば)|突破/.test(sentence)) return "CROSS_ABOVE";
  if (/下抜け|下に抜け|割れ|割り込/.test(sentence)) return "CROSS_BELOW";
  if (/反発|下げ止まり/.test(sentence)) return "REBOUND";
  if (/反落|上げ止まり|跳ね返/.test(sentence)) return "REJECTION";
  return "APPROACH";
}

function invalidationFor(sentences: string[], index: number) {
  return sentences.slice(index, index + 2).find((sentence) => /失効|無効|損切り|撤退|シナリオ.*崩/.test(sentence)) ?? "";
}

function messageFor(sourceType: AnalysisSourceType, pair: string, low: number, high: number, trigger: SignalTrigger, excerpt: string) {
  const level = low === high ? String(low) : `${low}から${high}`;
  const condition = trigger === "CROSS_ABOVE" ? "上抜けを監視"
    : trigger === "CROSS_BELOW" ? "下抜けを監視"
      : trigger === "REBOUND" ? "反発を監視"
        : trigger === "REJECTION" ? "反落を監視" : "接近中";
  const detail = compact(excerpt, 58);
  return compact(`${SOURCE_LABELS[sourceType]}。${pair}、注目水準${level}、${condition}。${detail}`, 120);
}

export function extractAnalysisSignals(input: {
  body: string;
  pair?: string;
  stance?: AnalysisStance;
  sourceType: AnalysisSourceType;
}) {
  const sentences = input.body
    .replace(/\r/g, "")
    .split(/(?<=[。！？!?])|\n+/)
    .map((sentence) => compact(sentence, 240))
    .filter(Boolean);
  const signals: ExtractedAnalysisSignal[] = [];
  let contextPair = input.pair ?? "FX";
  let contextStance = input.stance ?? stanceFor(input.body);
  sentences.forEach((sentence, index) => {
    const detectedPair = pairFor(sentence, "FX");
    if (detectedPair !== "FX") contextPair = detectedPair;
    const pair = detectedPair === "FX" ? contextPair : detectedPair;
    if (pair === "FX") return;
    const localStance = stanceFor(sentence);
    if (localStance !== "WAIT") contextStance = localStance;
    const prices = explicitPrices(sentence, pair);
    if (!prices.length) return;
    const trigger = triggerFor(sentence);
    const low = prices[0];
    const high = prices[1] ?? low;
    const invalidationText = invalidationFor(sentences, index);
    const signature = `${pair}:${low}:${high}:${trigger}`;
    if (signals.some((signal) => `${signal.pair}:${signal.levelLow}:${signal.levelHigh}:${signal.trigger}` === signature)) return;
    signals.push({
      pair,
      stance: localStance === "WAIT" ? contextStance : localStance,
      environment: environmentFor(sentence),
      priceRole: roleFor(sentence),
      levelLow: low,
      levelHigh: high,
      trigger,
      conditionText: sentence,
      invalidationText,
      sourceExcerpt: sentence,
      message: messageFor(input.sourceType, pair, low, high, trigger, sentence),
    });
  });
  return signals.slice(0, 12);
}
