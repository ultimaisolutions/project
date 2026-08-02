import { dispatchVisibilityChange, setDocumentHidden } from './setup-dom';
import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { cleanup, renderHook } from '@testing-library/react';
import { usePollingRefresh } from '../src/components/dashboard/usePollingRefresh';

const INTERVAL_MS = 20;
const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

describe('usePollingRefresh', () => {
  beforeEach(() => setDocumentHidden(false));
  afterEach(() => {
    cleanup();
    setDocumentHidden(false);
  });

  test('does not call onPoll before the interval elapses', async () => {
    // Arrange
    let calls = 0;
    renderHook(() => usePollingRefresh(() => { calls += 1; }, INTERVAL_MS));

    // Act
    await wait(INTERVAL_MS / 2);

    // Assert
    expect(calls).toBe(0);
  });

  test('calls onPoll once per interval while the tab is visible', async () => {
    // Arrange
    let calls = 0;
    renderHook(() => usePollingRefresh(() => { calls += 1; }, INTERVAL_MS));

    // Act
    await wait(INTERVAL_MS * 3.5);

    // Assert
    expect(calls).toBe(3);
  });

  test('skips the tick while document.hidden is true', async () => {
    // Arrange
    let calls = 0;
    renderHook(() => usePollingRefresh(() => { calls += 1; }, INTERVAL_MS));
    setDocumentHidden(true);

    // Act
    await wait(INTERVAL_MS * 3.5);

    // Assert
    expect(calls).toBe(0);
  });

  test('runs immediately on visibilitychange when the last run is older than the interval', async () => {
    // Arrange
    let calls = 0;
    renderHook(() => usePollingRefresh(() => { calls += 1; }, INTERVAL_MS));
    setDocumentHidden(true);
    await wait(INTERVAL_MS * 2.5);
    expect(calls).toBe(0);

    // Act
    setDocumentHidden(false);
    dispatchVisibilityChange();

    // Assert
    expect(calls).toBe(1);
  });

  test('does not run on visibilitychange when the last run is newer than the interval', () => {
    // Arrange
    let calls = 0;
    renderHook(() => usePollingRefresh(() => { calls += 1; }, INTERVAL_MS));

    // Act
    dispatchVisibilityChange();

    // Assert
    expect(calls).toBe(0);
  });

  test('calls the latest callback without restarting the interval', async () => {
    // Arrange
    let stale = 0;
    let fresh = 0;
    const { rerender } = renderHook(
      ({ onPoll }: { onPoll: () => void }) => usePollingRefresh(onPoll, INTERVAL_MS),
      { initialProps: { onPoll: () => { stale += 1; } } },
    );

    // Act
    await wait(INTERVAL_MS * 0.6);
    rerender({ onPoll: () => { fresh += 1; } });
    await wait(INTERVAL_MS * 0.6);

    // Assert
    expect(stale).toBe(0);
    expect(fresh).toBe(1);
  });

  test('clears the interval and listener on unmount', async () => {
    // Arrange
    let calls = 0;
    const { unmount } = renderHook(() => usePollingRefresh(() => { calls += 1; }, INTERVAL_MS));

    // Act
    unmount();
    await wait(INTERVAL_MS * 2.5);
    dispatchVisibilityChange();

    // Assert
    expect(calls).toBe(0);
  });
});
