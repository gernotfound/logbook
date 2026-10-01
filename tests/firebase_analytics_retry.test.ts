import { describe, expect, it, vi } from 'vitest';
import { createRetryableLazyLoader } from '../src/lib/utils/retryableLazyLoader';

describe('Firebase Analytics retryable lazy loader', () => {
  it('does not poison future consent attempts after a transient import failure', async () => {
    const load = vi.fn()
      .mockRejectedValueOnce(new Error('transient'))
      .mockResolvedValueOnce({ ready: true });
    const lazy = createRetryableLazyLoader(load);

    await expect(lazy()).rejects.toThrow('transient');
    await expect(lazy()).resolves.toEqual({ ready: true });
    expect(load).toHaveBeenCalledTimes(2);
  });

  it('shares one in-flight load between concurrent callers', async () => {
    let resolve!: (value: { ready: true }) => void;
    const load = vi.fn(() => new Promise<{ ready: true }>(done => { resolve = done; }));
    const lazy = createRetryableLazyLoader(load);

    const first = lazy();
    const second = lazy();
    expect(load).toHaveBeenCalledTimes(1);
    resolve({ ready: true });

    await expect(first).resolves.toEqual({ ready: true });
    await expect(second).resolves.toEqual({ ready: true });
  });
});
