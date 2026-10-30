import assert from 'node:assert/strict';
import test from 'node:test';
import { calculateThreeMinuteRsi, threeMinuteRsiAlert } from '../lib/three-minute-rsi.ts';

const now = 180 * 100;
const points = changes => {
  let price = 100;
  return [0, ...changes].map((change, index) => ({ timestamp: now - (15 - index) * 180, price: price += change }));
};

test('Wilder RSI produces strict high and low alerts from confirmed 3m bars', () => {
  assert.equal(calculateThreeMinuteRsi(points(Array(14).fill(1)), now)?.value, 100);
  assert.equal(calculateThreeMinuteRsi(points(Array(14).fill(1)), now)?.alert, 'high');
  assert.equal(calculateThreeMinuteRsi(points(Array(14).fill(-1)), now)?.alert, 'low');
});

test('30 and 70 are excluded from highlighting', () => {
  assert.equal(threeMinuteRsiAlert(29.999), 'low');
  assert.equal(threeMinuteRsiAlert(30), null);
  assert.equal(threeMinuteRsiAlert(70), null);
  assert.equal(threeMinuteRsiAlert(70.001), 'high');
});

test('incomplete, stale and discontinuous data never returns a misleading value', () => {
  assert.equal(calculateThreeMinuteRsi(points(Array(13).fill(1)), now), null);
  assert.equal(calculateThreeMinuteRsi(points(Array(14).fill(1)), now + 1000), null);
  const broken = points(Array(14).fill(1));
  broken[8].timestamp -= 180;
  assert.equal(calculateThreeMinuteRsi(broken, now), null);
});
