export type ThreeMinuteRsiResult = { value: number; alert: "high" | "low" | null; closedAt: number };

export function threeMinuteRsiAlert(value: number): ThreeMinuteRsiResult["alert"] {
  return value > 70 ? "high" : value < 30 ? "low" : null;
}

export function calculateThreeMinuteRsi(
  points: Array<{ timestamp: number; price: number }>,
  nowSeconds = Math.floor(Date.now() / 1000),
  period = 14,
): ThreeMinuteRsiResult | null {
  const step = 180;
  const currentBucket = Math.floor(nowSeconds / step) * step;
  const byBucket = new Map<number, number>();
  for (const point of points) {
    if (!Number.isFinite(point.timestamp) || !Number.isFinite(point.price) || point.price <= 0) continue;
    const bucket = Math.floor(point.timestamp / step) * step;
    if (bucket < currentBucket) byBucket.set(bucket, point.price);
  }
  const bars = [...byBucket].sort((a, b) => a[0] - b[0]);
  if (bars.length < period + 1) return null;
  const tail = bars.slice(-(period + 1));
  for (let index = 1; index < tail.length; index += 1) {
    if (tail[index][0] - tail[index - 1][0] !== step) return null;
  }
  const closedAt = tail.at(-1)![0] + step;
  if (nowSeconds - closedAt > step * 2 || closedAt > nowSeconds) return null;
  let gains = 0;
  let losses = 0;
  for (let index = 1; index < tail.length; index += 1) {
    const change = tail[index][1] - tail[index - 1][1];
    gains += Math.max(change, 0);
    losses += Math.max(-change, 0);
  }
  const averageGain = gains / period;
  const averageLoss = losses / period;
  const value = averageLoss === 0 ? (averageGain === 0 ? 50 : 100) : 100 - 100 / (1 + averageGain / averageLoss);
  return { value, alert: threeMinuteRsiAlert(value), closedAt };
}
