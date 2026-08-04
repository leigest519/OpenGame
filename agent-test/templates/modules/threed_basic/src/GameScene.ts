import {
  CircleGeometry,
  Color,
  EquirectangularReflectionMapping,
  IcosahedronGeometry,
  Mesh,
  MeshStandardMaterial,
  Object3D,
  PerspectiveCamera,
  Scene,
  SphereGeometry,
  Sprite,
  SpriteMaterial,
  SRGBColorSpace,
  Texture,
  Vector3,
  WebGLRenderer,
} from 'three';
import gameConfig from './gameConfig.json';
import { InputController } from './InputController';
import { initSceneMap } from './SceneMap';
import { applyThreeSceneDefaults } from './ThreeSceneDefaults';

export type GameSceneEvents = {
  onProgress: (collected: number, total: number) => void;
  onComplete: () => void;
  onGameOver: () => void;
};

export class GameScene {
  readonly renderer: WebGLRenderer;
  private readonly scene = new Scene();
  private readonly camera = new PerspectiveCamera(65, 1, 0.1, 200);
  private readonly input: InputController;
  private readonly collectibles: Object3D[] = [];
  private paused = false;
  private completed = false;
  private collected = 0;
  private yaw = 0;

  constructor(
    private readonly container: HTMLElement,
    private readonly events: GameSceneEvents,
    private readonly textures: Map<string, Texture> = new Map(),
  ) {
    this.renderer = new WebGLRenderer({ antialias: true, preserveDrawingBuffer: true });
    this.renderer.outputColorSpace = SRGBColorSpace;
    this.renderer.setPixelRatio(
      Math.min(devicePixelRatio, gameConfig.renderConfig.pixelRatioCap.value),
    );
    this.renderer.setSize(container.clientWidth, container.clientHeight);
    container.replaceChildren(this.renderer.domElement);
    this.input = new InputController(this.renderer.domElement);
    this.buildWorld();
    this.resize();
    this.events.onProgress(0, this.collectibles.length);
  }

  private buildWorld(): void {
    applyThreeSceneDefaults(this.scene);
    const skybox = this.textures.get('skybox_texture');
    if (skybox) {
      skybox.mapping = EquirectangularReflectionMapping;
      skybox.colorSpace = SRGBColorSpace;
      this.scene.background = skybox;
    }

    const map = initSceneMap();
    const floorTexture = this.textures.get('floor_patch');
    if (floorTexture) floorTexture.colorSpace = SRGBColorSpace;
    const floorMaterial = new MeshStandardMaterial({
      color: floorTexture ? 0xffffff : 0x123c66,
      map: floorTexture,
      roughness: 0.92,
    });
    for (const patch of map.floorPatches) {
      const floor = new Mesh(
        new CircleGeometry(patch.radius, 20),
        floorMaterial,
      );
      floor.rotation.x = -Math.PI / 2;
      floor.position.set(patch.x, 0, patch.z);
      this.scene.add(floor);
    }

    const obstacleMaterial = new MeshStandardMaterial({
      color: 0x7c3aed,
      emissive: new Color(0x21084f),
      flatShading: true,
    });
    for (const obstacle of map.obstacles) {
      const mesh = new Mesh(new IcosahedronGeometry(obstacle.scale, 0), obstacleMaterial);
      mesh.position.set(obstacle.x, obstacle.y, obstacle.z);
      this.scene.add(mesh);
    }

    const energyTexture = this.textures.get('energy_billboard');
    if (energyTexture) energyTexture.colorSpace = SRGBColorSpace;
    for (const item of map.collectibles) {
      const collectible = energyTexture
        ? new Sprite(new SpriteMaterial({ map: energyTexture, transparent: true }))
        : new Mesh(
            new SphereGeometry(0.55, 12, 8),
            new MeshStandardMaterial({ color: 0x67e8f9, emissive: 0x155e75 }),
          );
      collectible.name = item.id;
      collectible.position.set(item.x, item.y, item.z);
      collectible.scale.setScalar(energyTexture ? 1.8 : 1);
      this.collectibles.push(collectible);
      this.scene.add(collectible);
    }
    this.camera.position.set(0, 2.2, 7);
  }

  update(deltaSeconds: number): void {
    if (this.paused || this.completed) return;
    this.yaw -=
      this.input.consumeLookDelta() * gameConfig.playerConfig.mouseSensitivity.value;
    const { forward, strafe } = this.input.movement();
    const speed = gameConfig.playerConfig.moveSpeed.value * deltaSeconds;
    this.camera.position.x +=
      (Math.cos(this.yaw) * strafe + Math.sin(this.yaw) * forward) * speed;
    this.camera.position.z +=
      (Math.sin(this.yaw) * strafe - Math.cos(this.yaw) * forward) * speed;
    this.camera.position.x = Math.max(
      -gameConfig.levelConfig.trackHalfWidth.value,
      Math.min(gameConfig.levelConfig.trackHalfWidth.value, this.camera.position.x),
    );
    this.camera.position.z = Math.max(
      gameConfig.levelConfig.finishZ.value,
      Math.min(8, this.camera.position.z),
    );
    this.camera.rotation.y = this.yaw;

    for (const collectible of [...this.collectibles]) {
      collectible.rotation.y += deltaSeconds * 2;
      if (
        collectible.position.distanceTo(this.camera.position) <=
        gameConfig.levelConfig.collectRadius.value
      ) {
        this.scene.remove(collectible);
        this.collectibles.splice(this.collectibles.indexOf(collectible), 1);
        this.collected++;
        this.events.onProgress(this.collected, this.collected + this.collectibles.length);
      }
    }
    if (this.collectibles.length === 0) {
      this.completed = true;
      this.events.onComplete();
    }
    this.renderer.render(this.scene, this.camera);
  }

  setPaused(paused: boolean): void {
    this.paused = paused;
    this.input.clear();
  }

  isPaused(): boolean {
    return this.paused;
  }

  resize(): void {
    const size = new Vector3(
      Math.max(1, this.container.clientWidth),
      Math.max(1, this.container.clientHeight),
      0,
    );
    this.camera.aspect = size.x / size.y;
    this.camera.updateProjectionMatrix();
    this.renderer.setSize(size.x, size.y);
  }
}
