import { test } from 'node:test';
import assert from 'node:assert/strict';
import { startVisiblePolling } from '../src/client/visible-polling';

class Visibility extends EventTarget {
  hidden = false;
  change(hidden: boolean) {
    this.hidden = hidden;
    this.dispatchEvent(new Event('visibilitychange'));
  }
}
const flush = async () => {
  await Promise.resolve();
  await Promise.resolve();
};

test('polls only running work, stops on completion and does not restart on visibility', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const visibility = new Visibility();
  let calls = 0;
  const stop = startVisiblePolling(
    async () => ++calls < 2,
    2000,
    (error) => assert.fail(String(error)),
    visibility,
  );
  t.mock.timers.tick(1999);
  assert.equal(calls, 0);
  t.mock.timers.tick(1);
  await flush();
  assert.equal(calls, 1);
  t.mock.timers.tick(2000);
  await flush();
  assert.equal(calls, 2);
  visibility.change(true);
  visibility.change(false);
  t.mock.timers.tick(60000);
  assert.equal(calls, 2);
  stop();
});

test('hidden pages send nothing; returning resumes without overlapping a slow request', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const visibility = new Visibility();
  visibility.hidden = true;
  let calls = 0;
  let resolve!: (more: boolean) => void;
  const stop = startVisiblePolling(
    () => {
      calls++;
      return new Promise<boolean>((done) => {
        resolve = done;
      });
    },
    2000,
    (error) => assert.fail(String(error)),
    visibility,
  );
  t.mock.timers.tick(60000);
  assert.equal(calls, 0);
  visibility.change(false);
  assert.equal(calls, 1);
  t.mock.timers.tick(10000);
  visibility.change(true);
  visibility.change(false);
  assert.equal(calls, 1);
  resolve(true);
  await flush();
  visibility.change(true);
  t.mock.timers.tick(60000);
  assert.equal(calls, 1);
  stop();
  visibility.change(false);
  assert.equal(calls, 1);
});

test('errors back off and disposing in-flight work cannot schedule another request', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const visibility = new Visibility();
  let calls = 0;
  let errors = 0;
  let resolve!: (more: boolean) => void;
  const stop = startVisiblePolling(
    async () => {
      calls++;
      if (calls === 1) throw new Error('offline');
      return new Promise<boolean>((done) => {
        resolve = done;
      });
    },
    2000,
    () => {
      errors++;
    },
    visibility,
  );
  t.mock.timers.tick(2000);
  await flush();
  assert.equal(errors, 1);
  t.mock.timers.tick(3999);
  assert.equal(calls, 1);
  t.mock.timers.tick(1);
  assert.equal(calls, 2);
  stop();
  resolve(true);
  await flush();
  t.mock.timers.tick(60000);
  assert.equal(calls, 2);
});
