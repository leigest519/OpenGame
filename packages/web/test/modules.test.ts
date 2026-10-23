import { test } from 'node:test';
import assert from 'node:assert/strict';
import { WaveScheduler } from '../resources/modules/waves';

test('wave scheduling preserves order and does not continue after scene disposal', () => {
  const seen: [number, number][] = [];
  const waves = new WaveScheduler(
    [
      { count: 2, intervalMs: 100 },
      { count: 1, intervalMs: 80, delayMs: 50 },
    ],
    (w, i) => seen.push([w, i]),
  );
  waves.update(0);
  waves.update(100);
  waves.update(100);
  waves.update(50);
  assert.deepEqual(seen, [
    [1, 0],
    [1, 1],
    [2, 0],
  ]);
  assert.equal(waves.complete, true);
  const stopped = new WaveScheduler([{ count: 3, intervalMs: 20 }], (w, i) =>
    seen.push([w, i]),
  );
  stopped.stop();
  stopped.update(100);
  assert.equal(seen.length, 3);
});
test('invalid time/configuration cannot corrupt the scheduler; restart uses fresh state', () => {
  assert.throws(
    () => new WaveScheduler([{ count: -1, intervalMs: 1 }], () => {}),
  );
  assert.throws(
    () => new WaveScheduler([{ count: 1, intervalMs: 0 }], () => {}),
  );
  let count = 0;
  const scheduler = new WaveScheduler(
    [{ count: 2, intervalMs: 100 }],
    () => count++,
  );
  scheduler.update(Number.NaN);
  scheduler.update(-10);
  assert.equal(count, 0);
  scheduler.update(5000);
  assert.equal(count, 2);
});
