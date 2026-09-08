import { LevelManager } from '../LevelManager';
import type { SceneKeyData } from './UIScene';

export class PauseUIScene {
  private sceneKey = LevelManager.getFirstLevelScene();
  private keyHandler?: (event: KeyboardEvent) => void;

  init(data: SceneKeyData = {}): void {
    this.sceneKey =
      data.gameSceneKey ??
      data.currentLevelKey ??
      LevelManager.getFirstLevelScene();
  }

  show(onResume: (sceneKey: string) => void): void {
    const root = document.getElementById('ui-root');
    if (!root) return;
    root.insertAdjacentHTML(
      'beforeend',
      `<section id="pause-overlay" class="fixed inset-0 z-30 grid place-items-center bg-black/75 font-retro text-white">
        <div class="text-center"><h2 class="mb-8 text-4xl">GAME PAUSED</h2><button id="resume-btn" class="rounded border border-cyan-300 px-6 py-3">CONTINUE GAME</button></div>
      </section>`,
    );
    const resume = () => {
      this.hide();
      onResume(this.sceneKey);
    };
    root.querySelector('#resume-btn')?.addEventListener('click', resume, {
      once: true,
    });
    this.keyHandler = (event) => {
      if (event.code === 'Space' || event.code === 'Enter') {
        event.stopPropagation();
        resume();
      }
    };
    document.addEventListener('keydown', this.keyHandler);
  }

  hide(): void {
    if (this.keyHandler) document.removeEventListener('keydown', this.keyHandler);
    document.getElementById('pause-overlay')?.remove();
  }
}
