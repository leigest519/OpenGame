import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';

const root = document.getElementById('game-root')!;
root.innerHTML =
  '<button id="start-game">进入场景</button><button id="restart-game" hidden>重置视角</button><p>拖动环顾 · 滚轮远近</p>';
let renderer: THREE.WebGLRenderer | undefined;
let controls: OrbitControls;
const scene = new THREE.Scene();
scene.background = new THREE.Color('#10283c');
const camera = new THREE.PerspectiveCamera(48, 1, 0.1, 100);
function reset() {
  camera.position.set(9, 7, 13);
  controls.target.set(0, 1, 0);
  controls.update();
}
root.querySelector<HTMLButtonElement>('#start-game')!.onclick = () => {
  if (renderer) return;
  renderer = new THREE.WebGLRenderer({ antialias: true });
  renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
  root.append(renderer.domElement);
  controls = new OrbitControls(camera, renderer.domElement);
  controls.enableDamping = true;
  reset();
  scene.add(new THREE.HemisphereLight(0xaedfff, 0x152b38, 2));
  const moon = new THREE.DirectionalLight(0xc1e7ff, 3);
  moon.position.set(4, 12, 7);
  scene.add(moon);
  const ground = new THREE.Mesh(
    new THREE.PlaneGeometry(30, 30),
    new THREE.MeshStandardMaterial({
      color: 0x174754,
      roughness: 0.24,
      metalness: 0.45,
    }),
  );
  ground.rotation.x = -Math.PI / 2;
  scene.add(ground);
  for (const side of [-1, 1])
    for (let i = 0; i < 4; i++) {
      const house = new THREE.Mesh(
        new THREE.BoxGeometry(2, 2, 2),
        new THREE.MeshStandardMaterial({ color: 0xb6c9bf }),
      );
      house.position.set(side * 4, 1, 5 - i * 3);
      scene.add(house);
      const roof = new THREE.Mesh(
        new THREE.ConeGeometry(1.9, 1, 4),
        new THREE.MeshStandardMaterial({ color: 0x18343a }),
      );
      roof.rotation.y = Math.PI / 4;
      roof.position.copy(house.position).y = 2.5;
      scene.add(roof);
    }
  const lantern = new THREE.Mesh(
    new THREE.SphereGeometry(0.5, 16, 16),
    new THREE.MeshStandardMaterial({
      color: 0xffce8d,
      emissive: 0xffaa55,
      emissiveIntensity: 2,
    }),
  );
  lantern.position.set(0, 4, 0);
  scene.add(lantern);
  let elapsed = 0;
  const clock = new THREE.Clock();
  function resize() {
    const w = root.clientWidth,
      h = Math.max(180, innerHeight - 100);
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
    renderer!.setSize(w, h);
  }
  addEventListener('resize', resize);
  resize();
  renderer.setAnimationLoop(() => {
    const delta = Math.min(clock.getDelta(), 0.05);
    if (document.hidden) return;
    elapsed += delta;
    lantern.position.y = 4 + Math.sin(elapsed) * 0.3;
    controls.update();
    renderer!.render(scene, camera);
  });
  root.querySelector<HTMLButtonElement>('#start-game')!.hidden = true;
  root.querySelector<HTMLButtonElement>('#restart-game')!.hidden = false;
  root.querySelector<HTMLButtonElement>('#restart-game')!.onclick = () => {
    elapsed = 0;
    reset();
  };
};
