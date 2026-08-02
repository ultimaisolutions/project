import { useEffect, useRef } from 'react';

/**
 * Re-runs `onPoll` every `intervalMs` while the tab is visible.
 * Skips ticks in a hidden tab, and catches up immediately when the tab becomes
 * visible again if the last run is already older than the interval.
 */
export function usePollingRefresh(onPoll: () => void, intervalMs: number): void {
  const lastRunAt = useRef(Date.now());
  const callback = useRef(onPoll);
  callback.current = onPoll;

  useEffect(() => {
    /** Records and invokes the latest polling callback. */
    const run = () => {
      lastRunAt.current = Date.now();
      callback.current();
    };

    /** Runs a scheduled poll only while the document is visible. */
    const tick = () => {
      if (document.hidden) return;
      run();
    };

    /** Catches up after visibility returns when the interval has already elapsed. */
    const onVisible = () => {
      if (document.hidden) return;
      if (Date.now() - lastRunAt.current < intervalMs) return;
      run();
    };

    const timer = window.setInterval(tick, intervalMs);
    document.addEventListener('visibilitychange', onVisible);

    return () => {
      window.clearInterval(timer);
      document.removeEventListener('visibilitychange', onVisible);
    };
  }, [intervalMs]);
}
