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
    const run = () => {
      lastRunAt.current = Date.now();
      callback.current();
    };

    const tick = () => {
      if (document.hidden) return;
      run();
    };

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
