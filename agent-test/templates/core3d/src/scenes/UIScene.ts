import { LevelManager } from '../LevelManager';

export type SceneKeyData = {
  gameSceneKey?: string;
  currentLevelKey?: string;
};

export class UIScene {
  private sceneKey = LevelManager.getFirstLevelScene();

  init(data: SceneKeyData = {}): void {
    this.sceneKey =
      data.gameSceneKey ??
      data.currentLevelKey ??
      LevelManager.getFirstLevelScene();
  }

  show(onPause: (sceneKey: string) => void): void {
    const root = document.getElementById('ui-root');
    if (!root) return;
    root.innerHTML = `
      <div class="pointer-events-none fixed inset-0 z-10 font-retro text-white">
        <div class="absolute left-4 top-4 rounded bg-slate-950/70 px-4 py-3">
          <div class="text-xs text-cyan-300">ENERGY</div>
          <div id="score-text" class="text-xl">0 / 0</div>
        </div>
        <button id="pause-btn" class="pointer-events-auto absolute right-4 top-4 rounded border border-white/40 bg-slate-950/70 px-4 py-2">PAUSE</button>
        <div class="absolute bottom-4 left-4 text-xs text-white/70">WASD / ARROWS: MOVE · DRAG: LOOK · ESC: PAUSE</div>
      </div>`;
    root.querySelector('#pause-btn')?.addEventListener('click', () =>
      onPause(this.sceneKey),
    );
  }

  update(collected: number, total: number): void {
    const score = document.getElementById('score-text');
    if (score) score.textContent = `${collected} / ${total}`;
  }
}
