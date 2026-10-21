export type PositionSide = "BUY" | "SELL";

export type Position = {
  pair: string;
  side: PositionSide;
  entryPrice: number;
};

export type PositionMap = Record<string, Position>;

export function calculatePositionPips(position: Position, currentPrice: number, yenPair: boolean) {
  const pipSize = yenPair ? 0.01 : 0.0001;
  const priceDifference = position.side === "BUY"
    ? currentPrice - position.entryPrice
    : position.entryPrice - currentPrice;
  const rounded = Math.round((priceDifference / pipSize) * 10) / 10;
  return Object.is(rounded, -0) ? 0 : rounded;
}

export function positionPipsSpeech(pips: number) {
  if (pips > 0) return `プラス${pips.toFixed(1)}`;
  if (pips < 0) return `マイナス${Math.abs(pips).toFixed(1)}`;
  return "0.0";
}

export function restorePositions(value: string | null, supportedPairs: readonly string[]): PositionMap {
  if (!value) return {};
  try {
    const parsed = JSON.parse(value) as unknown;
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return {};
    const supported = new Set(supportedPairs);
    return Object.fromEntries(Object.entries(parsed).flatMap(([pair, candidate]) => {
      if (!supported.has(pair) || !candidate || typeof candidate !== "object") return [];
      const item = candidate as Partial<Position>;
      if ((item.side !== "BUY" && item.side !== "SELL")
        || typeof item.entryPrice !== "number" || !Number.isFinite(item.entryPrice) || item.entryPrice <= 0) return [];
      return [[pair, { pair, side: item.side, entryPrice: item.entryPrice } satisfies Position]];
    }));
  } catch {
    return {};
  }
}
