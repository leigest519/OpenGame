/** Poll only while visible; wait for each response before scheduling another. */
export function startVisiblePolling(
  poll: () => Promise<boolean>,
  intervalMs: number,
  onError: (error: unknown) => void,
  visibility: Pick<
    Document,
    'hidden' | 'addEventListener' | 'removeEventListener'
  > = document,
) {
  let stopped = false;
  let pending = false;
  let failures = 0;
  let timer: ReturnType<typeof setTimeout> | undefined;
  function schedule() {
    if (!stopped && !visibility.hidden)
      timer = setTimeout(run, Math.min(intervalMs * 2 ** failures, 30000));
  }
  async function run() {
    if (stopped || pending || visibility.hidden) return;
    pending = true;
    try {
      const more = await poll();
      failures = 0;
      if (!more) stopped = true;
    } catch (error) {
      failures = Math.min(failures + 1, 5);
      if (!stopped) onError(error);
    } finally {
      pending = false;
      schedule();
    }
  }
  function changed() {
    clearTimeout(timer);
    if (!visibility.hidden) void run();
  }
  visibility.addEventListener('visibilitychange', changed);
  schedule();
  return () => {
    stopped = true;
    clearTimeout(timer);
    visibility.removeEventListener('visibilitychange', changed);
  };
}
