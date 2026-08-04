import './styles/tailwind.css';
import { GameScene } from './GameScene';
import { Preloader } from './scenes/Preloader';
import { TitleScreen } from './scenes/TitleScreen';
import { UIScene } from './scenes/UIScene';
import { PauseUIScene } from './scenes/PauseUIScene';
import { GameCompleteUIScene } from './scenes/GameCompleteUIScene';
import { GameOverUIScene } from './scenes/GameOverUIScene';

declare global {
  interface Window {
    __opengame3d?: { isPaused: () => boolean; renderer: string };
  }
}

class GameApp {
  private readonly container = document.getElementById('game-container');
  private readonly preloader = new Preloader();
  private readonly title = new TitleScreen();
  private readonly ui = new UIScene();
  private readonly pauseUi = new PauseUIScene();
  private readonly completeUi = new GameCompleteUIScene();
  private readonly gameOverUi = new GameOverUIScene();
  private game?: GameScene;
  private lastFrame = performance.now();
  private ended = false;

  async boot(): Promise<void> {
    if (!this.container) throw new Error('Missing #game-container');
    await this.preloader.load();
    this.title.show(() => this.start());
    window.addEventListener('resize', () => this.game?.resize());
    window.addEventListener('keydown', (event) => {
      if (event.code === 'Escape' && this.game && !event.repeat && !this.ended) {
        if (this.game.isPaused()) this.resume('GameScene');
        else this.pause('GameScene');
      }
    });
    requestAnimationFrame(this.frame);
  }

  private start(): void {
    if (!this.container) return;
    this.ended = false;
    this.game = new GameScene(
      this.container,
      {
        onProgress: (collected, total) => this.ui.update(collected, total),
        onComplete: () => {
          this.ended = true;
          this.game?.setPaused(true);
          this.completeUi.show(() => this.restart());
        },
        onGameOver: () => {
          this.ended = true;
          this.game?.setPaused(true);
          this.gameOverUi.show(() => this.restart());
        },
      },
      this.preloader.textures,
    );
    this.ui.init({ gameSceneKey: 'GameScene' });
    this.ui.show((key) => this.pause(key));
    window.__opengame3d = {
      isPaused: () => this.game?.isPaused() ?? false,
      renderer: 'three.js',
    };
  }

  private pause(sceneKey: string): void {
    if (sceneKey !== 'GameScene' || !this.game || this.game.isPaused()) return;
    this.game.setPaused(true);
    this.pauseUi.init({ gameSceneKey: sceneKey });
    this.pauseUi.show((key) => this.resume(key));
  }

  private resume(sceneKey: string): void {
    if (sceneKey === 'GameScene') {
      this.pauseUi.hide();
      this.game?.setPaused(false);
    }
  }

  private restart(): void {
    this.pauseUi.hide();
    this.game?.dispose();
    this.game = undefined;
    this.start();
  }

  private readonly frame = (time: number): void => {
    const delta = Math.min(0.05, (time - this.lastFrame) / 1000);
    this.lastFrame = time;
    this.game?.update(delta);
    requestAnimationFrame(this.frame);
  };
}

new GameApp().boot();
