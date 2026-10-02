export const MODE2_POINT_COUNT = 7;
export const MODE2_BASE_FREQUENCY = 620;
export const MODE2_SEMITONES_PER_TYPICAL_MOVE = 1.725;
export const MODE2_MAX_SEMITONES = 12;
export const MODE2_MIN_FREQUENCY = MODE2_BASE_FREQUENCY / 2;
export const MODE2_MAX_FREQUENCY = MODE2_BASE_FREQUENCY * 2;

export type Mode2PricePoint = {
  price: number;
  timestamp: number;
};

export function appendMode2PricePoint(
  history: Mode2PricePoint[],
  point: Mode2PricePoint,
): { history: Mode2PricePoint[]; accepted: boolean } {
  if (!Number.isFinite(point.price) || point.price <= 0 || !Number.isFinite(point.timestamp)) {
    return { history, accepted: false };
  }
  const previous = history.at(-1);
  if (previous && point.timestamp < previous.timestamp) {
    return { history, accepted: false };
  }
  if (previous && point.timestamp === previous.timestamp && point.price === previous.price) {
    return { history, accepted: false };
  }
  return {
    history: [...history, point].slice(-MODE2_POINT_COUNT),
    accepted: true,
  };
}

function clamp(value: number, minimum: number, maximum: number) {
  return Math.min(maximum, Math.max(minimum, value));
}

export function buildMode2Frequencies(
  prices: number[],
  pipSize: number,
  recentMove: number,
): number[] {
  if (prices.length !== MODE2_POINT_COUNT || !prices.every((price) => Number.isFinite(price) && price > 0)) {
    return [];
  }
  if (!Number.isFinite(pipSize) || pipSize <= 0 || !Number.isFinite(recentMove) || recentMove <= 0) {
    return [];
  }
  const origin = prices[0];
  return prices.map((price) => {
    const relativePips = (price - origin) / pipSize;
    const semitones = clamp(
      (relativePips / recentMove) * MODE2_SEMITONES_PER_TYPICAL_MOVE,
      -MODE2_MAX_SEMITONES,
      MODE2_MAX_SEMITONES,
    );
    return clamp(
      MODE2_BASE_FREQUENCY * (2 ** (semitones / 12)),
      MODE2_MIN_FREQUENCY,
      MODE2_MAX_FREQUENCY,
    );
  });
}
