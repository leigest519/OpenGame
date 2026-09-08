import { AmbientLight, Color, DirectionalLight, Fog, Scene } from 'three';
import gameConfig from './gameConfig.json';

export function applyThreeSceneDefaults(scene: Scene): void {
  scene.background = new Color(0x060b21);
  scene.fog = new Fog(
    0x060b21,
    gameConfig.renderConfig.fogNear.value,
    gameConfig.renderConfig.fogFar.value,
  );
  scene.add(new AmbientLight(0x7dd3fc, 1.6));
  const keyLight = new DirectionalLight(0xffffff, 3.2);
  keyLight.position.set(8, 16, 10);
  scene.add(keyLight);
}
