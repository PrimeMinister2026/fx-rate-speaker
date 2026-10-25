export type AnalysisSourceType = "SHISHIN" | "YOUTUBE" | "OTHER";
export type AnalysisStance = "BUY" | "SELL" | "WAIT";
export type SignalTrigger = "APPROACH" | "CROSS_ABOVE" | "CROSS_BELOW" | "REBOUND" | "REJECTION";

export type ExtractedAnalysisSignal = {
  pair: string;
  stance: AnalysisStance;
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
  pair: string;
  stance: AnalysisStance;
  sourceType: AnalysisSourceType;
}) {
  const sentences = input.body
    .replace(/\r/g, "")
    .split(/(?<=[。！？!?])|\n+/)
    .map((sentence) => compact(sentence, 240))
    .filter(Boolean);
  const signals: ExtractedAnalysisSignal[] = [];
  sentences.forEach((sentence, index) => {
    const pair = pairFor(sentence, input.pair);
    if (pair === "FX") return;
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
      stance: input.stance,
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
