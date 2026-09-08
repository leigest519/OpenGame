export class GameOverUIScene {
  show(onRestart: () => void): void {
    const root = document.getElementById('ui-root');
    if (!root) return;
    root.innerHTML = `<section class="fixed inset-0 z-30 grid place-items-center bg-red-950/80 font-retro text-white"><div class="text-center"><h2 class="mb-8 text-5xl">GAME OVER</h2><button id="retry-btn" class="rounded border border-white px-6 py-3">RETRY</button></div></section>`;
    root.querySelector('#retry-btn')?.addEventListener('click', onRestart, {
      once: true,
    });
  }
}
