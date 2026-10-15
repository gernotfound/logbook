import { afterEach, describe, expect, it, vi } from 'vitest';
import { createJournalRetry, type JournalRetryState } from '../../src/lib/sync/journalRetry';

const initial = (): JournalRetryState => ({
    syncHealth: 'local-pending', syncing: false, localPersistenceBlocked: false, compatibilityStatus: 'ok',
});
function fixture() {
    let state = initial();
    let eligible = true;
    let listener: () => void = () => {};
    const flush = vi.fn(async () => {});
    const controller = createJournalRetry(
        () => state,
        cb => { listener = cb; return () => { listener = () => {}; }; },
        () => eligible, flush,
    );
    return {
        flush, controller,
        update: (changes: Partial<JournalRetryState>) => { state = { ...state, ...changes }; listener(); },
        eligible: (value: boolean) => { eligible = value; listener(); },
    };
}
afterEach(() => { vi.useRealTimers(); vi.restoreAllMocks(); });

describe('foreground durable journal backoff', () => {
    it('retries at increasing capped delays while journal stays pending, without duplicating a queue', async () => {
        vi.useFakeTimers();
        const retry = fixture();
        await vi.advanceTimersByTimeAsync(19_999);
        expect(retry.flush).not.toHaveBeenCalled();
        await vi.advanceTimersByTimeAsync(1);
        expect(retry.flush).toHaveBeenCalledTimes(1);
        await vi.advanceTimersByTimeAsync(39_999);
        expect(retry.flush).toHaveBeenCalledTimes(1);
        await vi.advanceTimersByTimeAsync(1);
        expect(retry.flush).toHaveBeenCalledTimes(2);
        retry.controller.dispose();
        await vi.advanceTimersByTimeAsync(300_000);
        expect(retry.flush).toHaveBeenCalledTimes(2);
    });

    it('never retries while offline, backgrounded, rejected, saving or storage-blocked', async () => {
        vi.useFakeTimers();
        const retry = fixture();
        retry.eligible(false);
        await vi.advanceTimersByTimeAsync(60_000);
        expect(retry.flush).not.toHaveBeenCalled();
        retry.eligible(true);
        retry.update({ syncHealth: 'rejected' });
        await vi.advanceTimersByTimeAsync(60_000);
        expect(retry.flush).not.toHaveBeenCalled();
        retry.update({ syncHealth: 'local-pending', localPersistenceBlocked: true });
        await vi.advanceTimersByTimeAsync(60_000);
        expect(retry.flush).not.toHaveBeenCalled();
        retry.update({ localPersistenceBlocked: false, syncing: true });
        await vi.advanceTimersByTimeAsync(60_000);
        expect(retry.flush).not.toHaveBeenCalled();
        retry.update({ syncing: false });
        await vi.advanceTimersByTimeAsync(20_000);
        expect(retry.flush).toHaveBeenCalledTimes(1);
        retry.controller.dispose();
    });

    it('resets attempts after success and cancels timers for session transitions', async () => {
        vi.useFakeTimers();
        const retry = fixture();
        await vi.advanceTimersByTimeAsync(20_000);
        retry.update({ syncHealth: 'synced' });
        await vi.advanceTimersByTimeAsync(100_000);
        expect(retry.flush).toHaveBeenCalledTimes(1);
        retry.update({ syncHealth: 'local-pending' });
        await vi.advanceTimersByTimeAsync(20_000);
        expect(retry.flush).toHaveBeenCalledTimes(2);
        retry.controller.dispose();
    });
});
