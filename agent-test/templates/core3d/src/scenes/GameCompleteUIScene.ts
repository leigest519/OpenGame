export class GameCompleteUIScene {
  show(onRestart: () => void): void {
    const root = document.getElementById('ui-root');
    if (!root) return;
    root.innerHTML = `<section class="fixed inset-0 z-30 grid place-items-center bg-slate-950/80 font-retro text-white"><div class="text-center"><h2 class="mb-4 text-5xl text-cyan-300">TRAIL COMPLETE</h2><p class="mb-8">All energy recovered.</p><button id="complete-btn" class="rounded border border-cyan-300 px-6 py-3">PLAY AGAIN</button></div></section>`;
    root.querySelector('#complete-btn')?.addEventListener('click', onRestart, {
      once: true,
    });
  }
}
