import Phaser from 'phaser';
import settings from '../gameConfig.json';

const root = document.getElementById('game-root')!;
root.innerHTML = `<div class="star-app"><div class="star-top"><span>STARDUST VOYAGER</span><span id="score">星尘 0</span></div><div id="canvas"></div><div id="cover"><span class="kicker">一次小小的星际旅行</span><h1>星尘远航</h1><p>驾驶飞船穿过流星，收集散落的星尘。</p><button id="start-game">开始远航 →</button><small>方向键 / WASD 移动 · 也可以拖动飞船</small></div><div class="star-bottom"><span id="hint">慢一点，也能抵达远方。</span><button id="restart-game" hidden>重新开始</button></div></div>`;
const style = document.createElement('style');
style.textContent = `.star-app{position:relative;min-height:100vh;overflow:hidden;background:#11172b}.star-top,.star-bottom{position:absolute;left:24px;right:24px;display:flex;justify-content:space-between;align-items:center;z-index:3;font-size:11px;color:#a6b3d1;letter-spacing:2px}.star-top{top:22px}.star-bottom{bottom:20px;letter-spacing:.5px}#cover{position:absolute;inset:0;display:flex;flex-direction:column;align-items:center;justify-content:center;text-align:center;padding:30px;z-index:4;background:linear-gradient(#11172b00,#11172b44)}#cover[hidden]{display:none}.kicker{color:#b8b0df;font-size:10px;letter-spacing:3px}#cover h1{font-size:42px;letter-spacing:8px;font-weight:500;margin:15px 0}#cover p{font-size:12px;color:#a2acc4;margin:0 0 28px}#start-game{border:0;background:#eeebff;color:#292741;padding:12px 25px;border-radius:9px}#cover small{font-size:10px;color:#8994af;margin-top:18px}#restart-game{background:#1e2942;border:1px solid #394461;color:#d1d9e8;border-radius:7px;padding:7px 11px;font-size:11px}#canvas{width:100%;height:100vh;min-height:340px}canvas{touch-action:none}@media(max-width:400px){#cover h1{font-size:31px;letter-spacing:5px}.star-top,.star-bottom{left:14px;right:14px;font-size:10px}}`;
document.head.append(style);
class Voyage extends Phaser.Scene {
  private ship!: Phaser.GameObjects.Graphics;
  private stars: Phaser.GameObjects.Arc[] = [];
  private obstacles: Phaser.GameObjects.Arc[] = [];
  private crystals: Phaser.GameObjects.Arc[] = [];
  private keys!: Phaser.Types.Input.Keyboard.CursorKeys;
  private wasd!: Record<string, Phaser.Input.Keyboard.Key>;
  private playing = false;
  private score = 0;
  private timer = 0;
  private invulnerable = 0;
  constructor() {
    super('voyage');
  }
  create() {
    const { width: w, height: h } = this.scale;
    for (let i = 0; i < 90; i++)
      this.stars.push(
        this.add.circle(
          Math.random() * w,
          Math.random() * h,
          i % 4 === 0 ? 1.4 : 0.7,
          0xd7dcfa,
          0.2 + Math.random() * 0.6,
        ),
      );
    this.add.circle(w * 0.74, h * 0.3, 65, 0x5b577f, 0.22);
    this.add
      .ellipse(w * 0.74, h * 0.3, 195, 48, 0x9288bd, 0.07)
      .setRotation(-0.35);
    this.ship = this.add.graphics();
    this.ship.fillStyle(0xa5eddc).fillTriangle(0, -18, -12, 12, 12, 12);
    this.ship.fillStyle(0xe8e7ff).fillTriangle(0, -10, -5, 9, 5, 9);
    this.ship.fillStyle(0x9a94e2, 0.6).fillTriangle(-5, 13, 5, 13, 0, 28);
    this.ship.setPosition(w / 2, h * 0.7);
    this.keys = this.input.keyboard!.createCursorKeys();
    this.wasd = this.input.keyboard!.addKeys('W,A,S,D') as Record<
      string,
      Phaser.Input.Keyboard.Key
    >;
    this.input.on('pointermove', (pointer: Phaser.Input.Pointer) => {
      if (this.playing && pointer.isDown)
        this.ship.setPosition(
          Phaser.Math.Clamp(pointer.x, 20, w - 20),
          Phaser.Math.Clamp(pointer.y, 65, h - 60),
        );
    });
  }
  begin() {
    this.obstacles.forEach((x) => x.destroy());
    this.crystals.forEach((x) => x.destroy());
    this.obstacles = [];
    this.crystals = [];
    this.score = 0;
    this.timer = 0;
    this.invulnerable = 0;
    this.ship
      .setPosition(this.scale.width / 2, this.scale.height * 0.72)
      .setAlpha(1);
    this.playing = true;
    document.getElementById('score')!.textContent = '星尘 0';
    document.getElementById('hint')!.textContent = '躲开陨石，收集青色星尘';
    document.getElementById('cover')!.hidden = true;
    document.getElementById('restart-game')!.hidden = false;
  }
  update(_time: number, delta: number) {
    const dt = Math.min(delta, 50) / 1000;
    const { width: w, height: h } = this.scale;
    this.stars.forEach((star, i) => {
      star.y += dt * (12 + (i % 6) * 6);
      if (star.y > h) star.y = 0;
    });
    if (!this.playing || !this.ship) return;
    const dx =
      Number(this.keys.right.isDown || this.wasd.D.isDown) -
      Number(this.keys.left.isDown || this.wasd.A.isDown);
    const dy =
      Number(this.keys.down.isDown || this.wasd.S.isDown) -
      Number(this.keys.up.isDown || this.wasd.W.isDown);
    this.ship.x = Phaser.Math.Clamp(
      this.ship.x + dx * settings.speed * dt,
      20,
      w - 20,
    );
    this.ship.y = Phaser.Math.Clamp(
      this.ship.y + dy * settings.speed * dt,
      65,
      h - 60,
    );
    this.timer += dt;
    this.invulnerable -= dt;
    this.ship.alpha = this.invulnerable > 0 ? 0.45 : 1;
    if (this.timer > 0.7) {
      this.timer = 0;
      this.obstacles.push(
        this.add
          .circle(
            25 + Math.random() * (w - 50),
            -20,
            9 + Math.random() * 12,
            0x8b7a9e,
          )
          .setStrokeStyle(1, 0xb8a9c9, 0.5),
      );
      this.crystals.push(
        this.add
          .circle(25 + Math.random() * (w - 50), -60, 5, 0xa6e7d6)
          .setStrokeStyle(5, 0xa6e7d6, 0.12),
      );
    }
    for (const item of this.obstacles) {
      item.y += settings.fallSpeed * dt;
      if (
        this.invulnerable <= 0 &&
        Phaser.Math.Distance.Between(item.x, item.y, this.ship.x, this.ship.y) <
          item.radius + 10
      ) {
        this.invulnerable = 1.4;
        this.score = Math.max(0, this.score - 2);
        item.y = h + 40;
        document.getElementById('score')!.textContent = `星尘 ${this.score}`;
        document.getElementById('hint')!.textContent =
          '碰到了流星，继续向前吧。';
      }
    }
    for (const item of this.crystals) {
      item.y += settings.fallSpeed * 0.8 * dt;
      if (
        Phaser.Math.Distance.Between(item.x, item.y, this.ship.x, this.ship.y) <
        24
      ) {
        this.score++;
        item.y = h + 40;
        document.getElementById('score')!.textContent = `星尘 ${this.score}`;
        document.getElementById('hint')!.textContent =
          this.score >= 15
            ? '已收集 15 枚星尘，航行目标达成！'
            : '又发现了一点宇宙的光。';
      }
    }
    this.obstacles = this.obstacles.filter((item) => {
      if (item.y > h + 30) {
        item.destroy();
        return false;
      }
      return true;
    });
    this.crystals = this.crystals.filter((item) => {
      if (item.y > h + 30) {
        item.destroy();
        return false;
      }
      return true;
    });
  }
}
const scene = new Voyage();
new Phaser.Game({
  type: Phaser.CANVAS,
  parent: 'canvas',
  backgroundColor: '#11172b',
  width: Math.max(320, innerWidth),
  height: Math.max(340, innerHeight),
  scene,
  scale: { mode: Phaser.Scale.FIT, autoCenter: Phaser.Scale.CENTER_BOTH },
  render: { antialias: true },
});
document
  .getElementById('start-game')!
  .addEventListener('click', () => scene.begin());
document
  .getElementById('restart-game')!
  .addEventListener('click', () => scene.begin());
