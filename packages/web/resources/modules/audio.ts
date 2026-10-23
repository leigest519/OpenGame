export type GameSound =
  | 'click'
  | 'build'
  | 'upgrade'
  | 'sell'
  | 'shoot'
  | 'hit'
  | 'reward'
  | 'damage'
  | 'wave'
  | 'win'
  | 'lose';
type Tone = {
  from: number;
  to: number;
  duration: number;
  delay?: number;
  wave?: OscillatorType;
};
const sounds: Record<GameSound, { cooldown: number; tones: Tone[] }> = {
  click: { cooldown: 0.06, tones: [{ from: 650, to: 850, duration: 0.05 }] },
  build: {
    cooldown: 0.08,
    tones: [{ from: 260, to: 520, duration: 0.1, wave: 'triangle' }],
  },
  upgrade: {
    cooldown: 0.12,
    tones: [
      { from: 440, to: 660, duration: 0.12 },
      { from: 660, to: 880, duration: 0.16, delay: 0.09 },
    ],
  },
  sell: { cooldown: 0.1, tones: [{ from: 660, to: 440, duration: 0.12 }] },
  shoot: {
    cooldown: 0.07,
    tones: [{ from: 280, to: 90, duration: 0.065, wave: 'triangle' }],
  },
  hit: {
    cooldown: 0.06,
    tones: [{ from: 170, to: 65, duration: 0.07, wave: 'triangle' }],
  },
  reward: { cooldown: 0.1, tones: [{ from: 880, to: 1175, duration: 0.12 }] },
  damage: {
    cooldown: 0.18,
    tones: [{ from: 200, to: 80, duration: 0.22, wave: 'triangle' }],
  },
  wave: {
    cooldown: 0.3,
    tones: [
      { from: 330, to: 330, duration: 0.1 },
      { from: 494, to: 494, duration: 0.18, delay: 0.12 },
    ],
  },
  win: {
    cooldown: 0.5,
    tones: [523, 659, 784].map((f, i) => ({
      from: f,
      to: f,
      duration: 0.24,
      delay: i * 0.13,
    })),
  },
  lose: {
    cooldown: 0.5,
    tones: [392, 330, 262].map((f, i) => ({
      from: f,
      to: f * 0.9,
      duration: 0.24,
      delay: i * 0.14,
      wave: 'triangle',
    })),
  },
};

/** Copy into the game. Call unlock() from a user gesture; never queue old sounds. */
export class GameAudio {
  private context?: AudioContext;
  private master?: GainNode;
  private voices = new Set<{ oscillator: OscillatorNode; gain: GainNode }>();
  private lastPlayed = new Map<GameSound, number>();
  private paused = false;
  private disposed = false;
  private silent = false;
  get muted() {
    return this.silent;
  }

  async unlock(): Promise<boolean> {
    if (this.disposed) return false;
    try {
      if (!this.context) {
        const Constructor =
          globalThis.AudioContext ||
          (
            globalThis as typeof globalThis & {
              webkitAudioContext?: typeof AudioContext;
            }
          ).webkitAudioContext;
        if (!Constructor) return false;
        this.context = new Constructor();
        this.master = this.context.createGain();
        this.master.gain.value = 0.16;
        this.master.connect(this.context.destination);
      }
      if (this.context.state !== 'running') await this.context.resume();
      return !this.disposed && this.context.state === 'running';
    } catch {
      return false;
    }
  }

  play(sound: GameSound): boolean {
    const context = this.context;
    if (
      this.disposed ||
      this.silent ||
      this.paused ||
      !context ||
      context.state !== 'running' ||
      !this.master
    )
      return false;
    const preset = sounds[sound];
    if (!preset) return false;
    const now = context.currentTime;
    if (
      now - (this.lastPlayed.get(sound) ?? -Infinity) < preset.cooldown ||
      this.voices.size + preset.tones.length > 8
    )
      return false;
    this.lastPlayed.set(sound, now);
    for (const tone of preset.tones) {
      const oscillator = context.createOscillator();
      const gain = context.createGain();
      const start = now + (tone.delay || 0);
      const end = start + tone.duration;
      oscillator.type = tone.wave || 'sine';
      oscillator.frequency.setValueAtTime(tone.from, start);
      oscillator.frequency.exponentialRampToValueAtTime(tone.to, end);
      gain.gain.setValueAtTime(0, start);
      gain.gain.linearRampToValueAtTime(0.3, start + 0.005);
      gain.gain.exponentialRampToValueAtTime(0.0001, end);
      oscillator.connect(gain).connect(this.master);
      const voice = { oscillator, gain };
      this.voices.add(voice);
      oscillator.onended = () => {
        this.voices.delete(voice);
        oscillator.disconnect();
        gain.disconnect();
      };
      oscillator.start(start);
      oscillator.stop(end + 0.01);
    }
    return true;
  }

  setMuted(muted: boolean): void {
    this.silent = muted;
    if (muted) this.stopAll();
  }
  setPaused(paused: boolean): void {
    this.paused = paused;
    if (paused) this.stopAll();
  }
  stopAll(): void {
    for (const { oscillator, gain } of this.voices) {
      oscillator.onended = null;
      try {
        oscillator.stop();
      } catch {
        /* Already ended. */
      }
      oscillator.disconnect();
      gain.disconnect();
    }
    this.voices.clear();
    this.lastPlayed.clear();
  }
  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.stopAll();
    this.master?.disconnect();
    void this.context?.close().catch(() => {});
  }
}
