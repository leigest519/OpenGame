import {
  AmbientLight,
  BoxGeometry,
  Color,
  DirectionalLight,
  Fog,
  Material,
  Mesh,
  MeshStandardMaterial,
  PerspectiveCamera,
  PlaneGeometry,
  Scene,
  Texture,
  WebGLRenderer,
} from 'three';
import gameConfig from './gameConfig.json';

export type GameSceneEvents = {
  onProgress: (collected: number, total: number) => void;
  onComplete: () => void;
  onGameOver: () => void;
};

export class GameScene {
  readonly renderer: WebGLRenderer;
  private readonly scene = new Scene();
  private readonly camera = new PerspectiveCamera(65, 1, 0.1, 200);
  private readonly keys = new Set<string>();
  private paused = false;
  private yaw = 0;
  private dragging = false;

  constructor(
    private readonly container: HTMLElement,
    private readonly events: GameSceneEvents,
    protected readonly textures: Map<string, Texture> = new Map(),
  ) {
    this.renderer = new WebGLRenderer({ antialias: true, preserveDrawingBuffer: true });
    this.renderer.setPixelRatio(
      Math.min(devicePixelRatio, gameConfig.renderConfig.pixelRatioCap.value),
    );
    this.renderer.setSize(container.clientWidth, container.clientHeight);
    container.replaceChildren(this.renderer.domElement);
    this.buildWorld();
    this.bindInputs();
    this.resize();
    this.events.onProgress(0, 0);
  }

  private buildWorld(): void {
    this.scene.background = new Color(0x071426);
    this.scene.fog = new Fog(
      0x071426,
      gameConfig.renderConfig.fogNear.value,
      gameConfig.renderConfig.fogFar.value,
    );
    this.scene.add(new AmbientLight(0x9ccfff, 1.5));
    const sun = new DirectionalLight(0xffffff, 3);
    sun.position.set(8, 14, 6);
    this.scene.add(sun);

    const floor = new Mesh(
      new PlaneGeometry(18, 90),
      new MeshStandardMaterial({ color: 0x123765, roughness: 0.8 }),
    );
    floor.rotation.x = -Math.PI / 2;
    floor.position.z = -32;
    this.scene.add(floor);

    const geometry = new BoxGeometry(1.5, 1.5, 1.5);
    for (let i = 0; i < 14; i++) {
      const marker = new Mesh(
        geometry,
        new MeshStandardMaterial({ color: i % 2 ? 0x22d3ee : 0xa855f7 }),
      );
      marker.position.set(i % 2 ? 5 : -5, 1, -i * 6);
      this.scene.add(marker);
    }
    this.camera.position.set(0, 2.2, 7);
  }

  private bindInputs(): void {
    window.addEventListener('keydown', this.onKeyDown);
    window.addEventListener('keyup', this.onKeyUp);
    this.renderer.domElement.addEventListener('pointerdown', this.onPointerDown);
    window.addEventListener('pointerup', this.onPointerUp);
    window.addEventListener('pointermove', this.onPointerMove);
  }

  private readonly onKeyDown = (event: KeyboardEvent): void => {
    this.keys.add(event.code);
  };

  private readonly onKeyUp = (event: KeyboardEvent): void => {
    this.keys.delete(event.code);
  };

  private readonly onPointerDown = (): void => {
    this.dragging = true;
  };

  private readonly onPointerUp = (): void => {
    this.dragging = false;
  };

  private readonly onPointerMove = (event: PointerEvent): void => {
    if (this.dragging) this.yaw -= event.movementX * gameConfig.playerConfig.mouseSensitivity.value;
  };

  update(deltaSeconds: number): void {
    if (this.paused) return;
    const forward =
      Number(this.keys.has('KeyW') || this.keys.has('ArrowUp')) -
      Number(this.keys.has('KeyS') || this.keys.has('ArrowDown'));
    const strafe =
      Number(this.keys.has('KeyD') || this.keys.has('ArrowRight')) -
      Number(this.keys.has('KeyA') || this.keys.has('ArrowLeft'));
    const speed = gameConfig.playerConfig.moveSpeed.value * deltaSeconds;
    this.camera.position.x +=
      (Math.cos(this.yaw) * strafe - Math.sin(this.yaw) * forward) * speed;
    this.camera.position.z +=
      (Math.sin(this.yaw) * strafe - Math.cos(this.yaw) * forward) * speed;
    this.camera.position.x = Math.max(-8, Math.min(8, this.camera.position.x));
    this.camera.position.z = Math.max(-78, Math.min(8, this.camera.position.z));
    this.camera.rotation.y = this.yaw;
    this.renderer.render(this.scene, this.camera);
  }

  setPaused(paused: boolean): void {
    this.paused = paused;
    this.keys.clear();
  }

  isPaused(): boolean {
    return this.paused;
  }

  dispose(): void {
    window.removeEventListener('keydown', this.onKeyDown);
    window.removeEventListener('keyup', this.onKeyUp);
    this.renderer.domElement.removeEventListener('pointerdown', this.onPointerDown);
    window.removeEventListener('pointerup', this.onPointerUp);
    window.removeEventListener('pointermove', this.onPointerMove);
    this.scene.traverse((object) => {
      if (!(object instanceof Mesh)) return;
      object.geometry.dispose();
      const materials: Material[] = Array.isArray(object.material)
        ? object.material
        : [object.material];
      for (const material of materials) material.dispose();
    });
    this.renderer.dispose();
    this.renderer.domElement.remove();
  }

  resize(): void {
    const width = Math.max(1, this.container.clientWidth);
    const height = Math.max(1, this.container.clientHeight);
    this.camera.aspect = width / height;
    this.camera.updateProjectionMatrix();
    this.renderer.setSize(width, height);
  }
}
