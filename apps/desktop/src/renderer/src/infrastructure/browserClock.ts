import type { Clock } from '@rezets/core';

/** {@link Clock} backed by the browser's timers. */
export const browserClock: Clock = {
  now: () => performance.now(),
  repeat(intervalMs, callback) {
    const timerId = window.setInterval(callback, intervalMs);
    return () => window.clearInterval(timerId);
  },
};
