import { statSync } from 'node:fs';

// The owner refreshes this read-only lease. A killed worker cannot leave an
// unbounded container behind; exiting PID 1 also stops any docker-exec children.
const check = () => {
  try {
    if (Date.now() - statSync('/input/lease').mtimeMs > 30_000) process.exit(0);
  } catch {
    process.exit(0);
  }
};
check();
setInterval(check, 1000);
setTimeout(() => process.exit(0), 600_000);
