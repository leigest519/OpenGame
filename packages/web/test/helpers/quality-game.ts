import { copyFile, mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parsePlaytestPlan } from '../../src/server/game-playtest';

export const qualityPlan = parsePlaytestPlan({
  version: 1,
  steps: [
    { action: 'click', selector: 'canvas', x: 0.25, y: 0.5 },
    { action: 'expect', selector: '#state', text: '建造 1 · 金币 220' },
    { action: 'key', key: 'ArrowRight', holdMs: 30 },
    { action: 'expect', selector: '#state', text: '移动 1' },
  ],
});

export async function qualityFixture(directory: string) {
  await mkdir(path.join(directory, 'src'), { recursive: true });
  for (const name of [
    'game.project.json',
    'gameConfig.json',
    'modules.lock.json',
    'assets.manifest.json',
  ])
    await writeFile(path.join(directory, name), '{}');
  for (const name of ['design.md', 'memory.md'])
    await writeFile(
      path.join(directory, name),
      'Browser verification fixture.',
    );
  await writeFile(
    path.join(directory, 'playtest.json'),
    JSON.stringify(qualityPlan),
  );
  await copyFile(
    fileURLToPath(new URL('../../resources/modules/audio.ts', import.meta.url)),
    path.join(directory, 'src/audio.ts'),
  );
  await writeFile(
    path.join(directory, 'src/main.ts'),
    `
import { GameAudio } from './audio';
const audio = new GameAudio();
// Exposed only by this test fixture to measure actual Web Audio output.
Object.assign(window, { fixtureAudio: audio });
document.querySelector('#game-root')!.innerHTML = '<main style="max-width:960px;margin:auto;padding:16px"><h1>积木试玩验证</h1><button id="start-game">开始</button><section id="game" hidden><p id="state"></p><canvas width="600" height="320" style="width:100%;height:auto"></canvas><button id="mute">音效开</button><button id="pause">暂停</button><button id="celebrate">胜利</button><button id="restart-game">重开</button><button id="exit">退出</button></section></main>';
const canvas = document.querySelector('canvas')!;
const context = canvas.getContext('2d')!;
let count = 0, moves = 0, paused = false;
function paint() {
  context.fillStyle = '#c5d99e'; context.fillRect(0, 0, 600, 320);
  context.fillStyle = '#eeddb0'; context.fillRect(0, 140, 600, 50);
  context.fillStyle = '#26705a';
  for (let i = 0; i < count; i++) context.fillRect(100 + i * 60 + moves * 5, 95, 35, 35);
  document.querySelector('#state')!.textContent = '建造 ' + count + ' · 金币 ' + (300 - count * 80) + ' · 移动 ' + moves;
}
document.querySelector('#start-game')!.addEventListener('click', async () => {
  await audio.unlock();
  document.querySelector('#start-game')!.setAttribute('hidden', '');
  document.querySelector('#game')!.removeAttribute('hidden'); paint();
});
canvas.addEventListener('click', () => { if (!paused) { count++; audio.play('build'); paint(); } });
window.addEventListener('keydown', event => { if (!paused && event.key === 'ArrowRight') { event.preventDefault(); moves++; paint(); } });
document.querySelector('#mute')!.addEventListener('click', () => {
  audio.setMuted(!audio.muted); document.querySelector('#mute')!.textContent = audio.muted ? '音效关' : '音效开';
});
document.querySelector('#pause')!.addEventListener('click', async () => {
  paused = !paused; if (!paused) await audio.unlock(); audio.setPaused(paused);
  document.querySelector('#pause')!.textContent = paused ? '继续' : '暂停';
});
document.querySelector('#celebrate')!.addEventListener('click', () => audio.play('win'));
document.querySelector('#restart-game')!.addEventListener('click', () => {
  audio.stopAll(); audio.setPaused(false); paused = false; count = 0; moves = 0;
  document.querySelector('#pause')!.textContent = '暂停'; paint();
});
document.querySelector('#exit')!.addEventListener('click', () => audio.dispose());
`,
  );
  return directory;
}
