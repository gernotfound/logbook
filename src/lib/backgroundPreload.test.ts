import { afterEach, describe, expect, it, vi } from 'vitest';
import { scheduleSequentialIdlePreload } from './backgroundPreload';

function setVisibility(value: DocumentVisibilityState) {
  Object.defineProperty(document, 'visibilityState', {
    configurable: true,
    value,
  });
}

describe('scheduleSequentialIdlePreload', () => {
  afterEach(() => {
    vi.useRealTimers();
    setVisibility('visible');
  });

  it('preloads tasks sequentially after the initial idle delay', async () => {
    vi.useFakeTimers();
    setVisibility('visible');
    const first = vi.fn().mockResolvedValue(undefined);
    const second = vi.fn().mockResolvedValue(undefined);

    const cancel = scheduleSequentialIdlePreload(
      [first, second],
      {
        initialDelayMs: 10,
        fallbackIdleDelayMs: 5,
        isConstrainedNetwork: () => false,
      },
    );

    await vi.advanceTimersByTimeAsync(14);
    expect(first).not.toHaveBeenCalled();

    await vi.advanceTimersByTimeAsync(1);
    expect(first).toHaveBeenCalledTimes(1);
    expect(second).not.toHaveBeenCalled();

    await vi.advanceTimersByTimeAsync(5);
    expect(second).toHaveBeenCalledTimes(1);

    cancel();
  });

  it('cancels pending work when the user navigates away', async () => {
    vi.useFakeTimers();
    setVisibility('visible');
    const task = vi.fn().mockResolvedValue(undefined);

    const cancel = scheduleSequentialIdlePreload(
      [task],
      {
        initialDelayMs: 10,
        fallbackIdleDelayMs: 5,
        isConstrainedNetwork: () => false,
      },
    );

    cancel();
    await vi.advanceTimersByTimeAsync(100);

    expect(task).not.toHaveBeenCalled();
  });

  it('pauses while hidden and resumes when visible again', async () => {
    vi.useFakeTimers();
    setVisibility('visible');
    const task = vi.fn().mockResolvedValue(undefined);

    scheduleSequentialIdlePreload(
      [task],
      {
        initialDelayMs: 10,
        fallbackIdleDelayMs: 5,
        isConstrainedNetwork: () => false,
      },
    );

    await vi.advanceTimersByTimeAsync(10);
    setVisibility('hidden');
    document.dispatchEvent(new Event('visibilitychange'));
    await vi.advanceTimersByTimeAsync(100);
    expect(task).not.toHaveBeenCalled();

    setVisibility('visible');
    document.dispatchEvent(new Event('visibilitychange'));
    await vi.advanceTimersByTimeAsync(5);
    expect(task).toHaveBeenCalledTimes(1);
  });

  it('does no speculative loading on constrained connections', async () => {
    vi.useFakeTimers();
    setVisibility('visible');
    const task = vi.fn().mockResolvedValue(undefined);

    scheduleSequentialIdlePreload(
      [task],
      {
        initialDelayMs: 0,
        fallbackIdleDelayMs: 0,
        isConstrainedNetwork: () => true,
      },
    );

    await vi.runAllTimersAsync();
    expect(task).not.toHaveBeenCalled();
  });
});
