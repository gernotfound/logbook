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
        const delays = [20_000, 40_000, 80_000, 160_000, 300_000, 300_000];
        for (const [index, delay] of delays.entries()) {
            await vi.advanceTimersByTimeAsync(delay - 1);
            expect(retry.flush).toHaveBeenCalledTimes(index);
            await vi.advanceTimersByTimeAsync(1);
            expect(retry.flush).toHaveBeenCalledTimes(index + 1);
        }
        retry.controller.dispose();
        await vi.advanceTimersByTimeAsync(600_000);
        expect(retry.flush).toHaveBeenCalledTimes(delays.length);
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

    it('resets attempts after a confirmed sync and cancels timers on disposal', async () => {
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

    it('does not replay a previously scheduled timer while the caller disallows cloud sync', async () => {
        vi.useFakeTimers();
        const retry = fixture();
        await vi.advanceTimersByTimeAsync(10_000);
        retry.eligible(false); // E.g. background, revoked consent, or owner transition.
        await vi.advanceTimersByTimeAsync(600_000);
        expect(retry.flush).not.toHaveBeenCalled();
        retry.eligible(true);
        await vi.advanceTimersByTimeAsync(19_999);
        expect(retry.flush).not.toHaveBeenCalled();
        await vi.advanceTimersByTimeAsync(1);
        expect(retry.flush).toHaveBeenCalledTimes(1);
        retry.controller.dispose();
    });
});
