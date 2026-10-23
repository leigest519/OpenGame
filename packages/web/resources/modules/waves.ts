export interface Wave {
  count: number;
  intervalMs: number;
  delayMs?: number;
}

/** Engine-independent scheduling. The owner calls update and owns spawned enemies. */
export class WaveScheduler {
  private elapsed = 0;
  private cursor = 0;
  private stopped = false;
  private readonly schedule: { at: number; wave: number; index: number }[] = [];
  constructor(
    waves: Wave[],
    private readonly spawn: (wave: number, index: number) => void,
  ) {
    let time = 0;
    waves.forEach((wave, number) => {
      if (
        !Number.isInteger(wave.count) ||
        wave.count < 0 ||
        !Number.isFinite(wave.intervalMs) ||
        wave.intervalMs <= 0 ||
        !Number.isFinite(wave.delayMs ?? 0) ||
        (wave.delayMs ?? 0) < 0
      )
        throw new Error('Invalid wave configuration');
      time += wave.delayMs ?? 0;
      for (let i = 0; i < wave.count; i++) {
        this.schedule.push({ at: time, wave: number + 1, index: i });
        time += wave.intervalMs;
      }
    });
  }
  update(deltaMs: number): void {
    if (this.stopped || !Number.isFinite(deltaMs) || deltaMs < 0) return;
    this.elapsed += Math.min(deltaMs, 100);
    while (
      !this.stopped &&
      this.cursor < this.schedule.length &&
      this.schedule[this.cursor].at <= this.elapsed
    ) {
      const event = this.schedule[this.cursor++];
      this.spawn(event.wave, event.index);
    }
  }
  stop(): void {
    this.stopped = true;
  }
  get complete(): boolean {
    return this.cursor === this.schedule.length;
  }
}
