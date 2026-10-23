import { test } from 'node:test';
import assert from 'node:assert/strict';
import { GameAudio } from '../resources/modules/audio';

class Parameter {
  value = 0;
  setValueAtTime() {}
  exponentialRampToValueAtTime() {}
  linearRampToValueAtTime() {}
}
class Voice {
  frequency = new Parameter();
  type = 'sine';
  stopped = false;
  disconnected = false;
  onended: (() => void) | null = null;
  connect(target: unknown) {
    return target;
  }
  disconnect() {
    this.disconnected = true;
  }
  start() {}
  stop(at?: number) {
    if (at === undefined) this.stopped = true;
  }
}
class Context {
  static instances: Context[] = [];
  currentTime = 0;
  state = 'suspended';
  destination = {};
  voices: Voice[] = [];
  constructor() {
    Context.instances.push(this);
  }
  createGain() {
    return {
      gain: new Parameter(),
      connect: (target: unknown) => target,
      disconnect() {},
    };
  }
  createOscillator() {
    const voice = new Voice();
    this.voices.push(voice);
    return voice;
  }
  async resume() {
    this.state = 'running';
  }
  async close() {
    this.state = 'closed';
  }
}

test('audio unlock, rate limits, mute/pause and disposal bound playback and clear scheduled voices', async () => {
  const original = globalThis.AudioContext;
  globalThis.AudioContext = Context as unknown as typeof AudioContext;
  try {
    const audio = new GameAudio();
    assert.equal(audio.play('shoot'), false);
    assert.equal(Context.instances.length, 0);
    assert.equal(await audio.unlock(), true);
    const context = Context.instances.at(-1)!;
    assert.equal(audio.play('shoot'), true);
    assert.equal(audio.play('shoot'), false);
    context.currentTime += 0.2;
    assert.equal(audio.play('win'), true);
    assert.equal(audio.play('lose'), true);
    assert.equal(audio.play('upgrade'), false); // Would exceed eight live/scheduled voices.
    audio.setMuted(true);
    assert(context.voices.every((v) => v.stopped && v.disconnected));
    assert.equal(audio.play('build'), false);
    audio.setMuted(false);
    assert.equal(audio.play('build'), true);
    audio.setPaused(true);
    assert.equal(audio.play('reward'), false);
    audio.setPaused(false);
    assert.equal(audio.play('reward'), true);
    audio.dispose();
    audio.dispose();
    assert.equal(context.state, 'closed');
    assert.equal(await audio.unlock(), false);
    assert.equal(audio.play('wave'), false);
    assert.equal(Context.instances.length, 1);
  } finally {
    globalThis.AudioContext = original;
  }
});

test('unsupported audio degrades to a silent playable game without queuing old events', async () => {
  const original = globalThis.AudioContext;
  globalThis.AudioContext = undefined as unknown as typeof AudioContext;
  try {
    const audio = new GameAudio();
    assert.equal(await audio.unlock(), false);
    assert.equal(audio.play('click'), false);
    audio.stopAll();
    audio.dispose();
  } finally {
    globalThis.AudioContext = original;
  }
});
