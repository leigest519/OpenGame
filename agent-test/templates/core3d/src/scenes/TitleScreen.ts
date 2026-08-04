export class TitleScreen {
  private keyHandler?: (event: KeyboardEvent) => void;

  show(onStart: () => void): void {
    const root = document.getElementById('ui-root');
    if (!root) return;
    root.innerHTML = `
      <section class="fixed inset-0 z-20 grid place-items-center bg-slate-950/70 font-retro text-white">
        <div class="text-center">
          <p class="mb-3 text-sm tracking-[0.5em] text-cyan-300">OPENGAME 3D</p>
          <h1 class="mb-10 text-5xl font-bold">PRISM TRAIL</h1>
          <button id="start-btn" class="rounded border border-cyan-300 px-6 py-3 text-cyan-100">PRESS ENTER</button>
        </div>
      </section>`;
    const start = () => {
      this.hide();
      onStart();
    };
    root.querySelector('#start-btn')?.addEventListener('click', start, {
      once: true,
    });
    this.keyHandler = (event) => {
      if (event.code === 'Enter' || event.code === 'Space') start();
    };
    document.addEventListener('keydown', this.keyHandler);
  }

  hide(): void {
    if (this.keyHandler) document.removeEventListener('keydown', this.keyHandler);
    const root = document.getElementById('ui-root');
    if (root) root.innerHTML = '';
  }
}
