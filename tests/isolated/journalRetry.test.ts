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
            // Observe an early retry before a shrinking-delay mutant can loop
            // through indefinitely many fake timers inside one large advance.
            await vi.advanceTimersByTimeAsync(10_000);
            expect(retry.flush).toHaveBeenCalledTimes(index);
            await vi.advanceTimersByTimeAsync(delay - 10_001);
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

    it('restarts every interruption timer from the moment the journal becomes eligible again', async () => {
        vi.useFakeTimers();
        const blockers: Array<Partial<JournalRetryState>> = [
            { syncHealth: 'failed' }, { syncHealth: 'rejected' },
            { syncHealth: 'saving' }, { syncing: true },
            { localPersistenceBlocked: true }, { compatibilityStatus: 'update-required' },
        ];
        for (const blocked of blockers) {
            const retry = fixture();
            await vi.advanceTimersByTimeAsync(10_000);
            retry.update(blocked);
            await vi.advanceTimersByTimeAsync(1_000);
            retry.update(initial());
            await vi.advanceTimersByTimeAsync(9_000);
            expect(retry.flush).not.toHaveBeenCalled();
            await vi.advanceTimersByTimeAsync(11_000);
            expect(retry.flush).toHaveBeenCalledTimes(1);
            retry.controller.dispose();
        }
    });

    it('reset cancels the old exponential timer and refresh explicitly starts at the initial delay', async () => {
        vi.useFakeTimers();
        const retry = fixture();
        await vi.advanceTimersByTimeAsync(20_000);
        expect(retry.flush).toHaveBeenCalledTimes(1);
        retry.controller.reset();
        await vi.advanceTimersByTimeAsync(80_000);
        expect(retry.flush).toHaveBeenCalledTimes(1);
        retry.controller.refresh();
        await vi.advanceTimersByTimeAsync(19_999);
        expect(retry.flush).toHaveBeenCalledTimes(1);
        await vi.advanceTimersByTimeAsync(1);
        expect(retry.flush).toHaveBeenCalledTimes(2);
        retry.controller.dispose();
    });

    it('dispose cancels pending work and also refuses future refresh or subscription callbacks', async () => {
        vi.useFakeTimers();
        const retry = fixture();
        retry.controller.dispose();
        retry.update({ syncHealth: 'local-pending' });
        retry.controller.refresh();
        expect(vi.getTimerCount()).toBe(0);
        await vi.advanceTimersByTimeAsync(600_000);
        expect(retry.flush).not.toHaveBeenCalled();
    });

    it('never schedules overlapping flushes while one durable journal attempt is unresolved', async () => {
        vi.useFakeTimers();
        let notify: () => void = () => {};
        let release: () => void = () => {};
        const flush = vi.fn(() => new Promise<void>(resolve => { release = () => resolve(); }));
        const controller = createJournalRetry(
            initial, listener => { notify = listener; return () => { notify = () => {}; }; },
            () => true, flush,
        );
        await vi.advanceTimersByTimeAsync(20_000);
        expect(flush).toHaveBeenCalledTimes(1);
        notify();
        await vi.advanceTimersByTimeAsync(600_000);
        expect(flush).toHaveBeenCalledTimes(1);
        release();
        await vi.advanceTimersByTimeAsync(0);
        await vi.advanceTimersByTimeAsync(39_999);
        expect(flush).toHaveBeenCalledTimes(1);
        await vi.advanceTimersByTimeAsync(1);
        expect(flush).toHaveBeenCalledTimes(2);
        controller.dispose();
        release();
        await vi.advanceTimersByTimeAsync(0);
    });

    it('logs retry failures and continues from the durable pending journal without a second queue', async () => {
        vi.useFakeTimers();
        const error = new Error('temporary sync outage');
        const warning = vi.spyOn(console, 'warn').mockImplementation(() => {});
        const flush = vi.fn().mockRejectedValueOnce(error).mockResolvedValue(undefined);
        const controller = createJournalRetry(initial, () => () => {}, () => true, flush);
        await vi.advanceTimersByTimeAsync(20_000);
        expect(flush).toHaveBeenCalledTimes(1);
        expect(warning).toHaveBeenCalledWith('Retry journal in primo piano non completato:', error);
        await vi.advanceTimersByTimeAsync(40_000);
        expect(flush).toHaveBeenCalledTimes(2);
        controller.dispose();
    });



    it('revalidates durable-journal and consent gates when a timer fires even without a subscriber notification', async () => {
        vi.useFakeTimers();
        const blocked: Array<Partial<JournalRetryState>> = [
            { syncHealth: 'synced' }, { syncHealth: 'failed' },
            { syncHealth: 'rejected' }, { syncHealth: 'saving' },
            { syncing: true }, { localPersistenceBlocked: true },
            { compatibilityStatus: 'update-required' },
        ];
        for (const changes of blocked) {
            let state = initial();
            const flush = vi.fn(async () => {});
            const retry = createJournalRetry(
                () => state, () => () => {}, () => true, flush,
            );
            await vi.advanceTimersByTimeAsync(19_999);
            state = { ...state, ...changes };
            await vi.advanceTimersByTimeAsync(1);
            expect(flush).not.toHaveBeenCalled();
            expect(vi.getTimerCount()).toBe(0);
            retry.dispose();
        }

        let eligible = true;
        const offlineFlush = vi.fn(async () => {});
        const offlineRetry = createJournalRetry(
            initial, () => () => {}, () => eligible, offlineFlush,
        );
        await vi.advanceTimersByTimeAsync(19_999);
        eligible = false;
        await vi.advanceTimersByTimeAsync(1);
        expect(offlineFlush).not.toHaveBeenCalled();
        offlineRetry.dispose();
    });

    it('unsubscribes and cancels all pending timers on disposal even if a stale listener fires', async () => {
        vi.useFakeTimers();
        let notify: () => void = () => {};
        const unsubscribe = vi.fn();
        const flush = vi.fn(async () => {});
        const retry = createJournalRetry(
            initial, listener => { notify = listener; return unsubscribe; }, () => true, flush,
        );
        expect(vi.getTimerCount()).toBe(1);
        retry.dispose();
        expect(unsubscribe).toHaveBeenCalledTimes(1);
        expect(vi.getTimerCount()).toBe(0);
        notify();
        retry.refresh();
        await vi.advanceTimersByTimeAsync(600_000);
        expect(flush).not.toHaveBeenCalled();
        expect(vi.getTimerCount()).toBe(0);
    });

    it('does not requeue an in-flight retry after the durable journal has been confirmed synced', async () => {
        vi.useFakeTimers();
        let state = initial();
        let notify: () => void = () => {};
        let complete: () => void = () => {};
        const flush = vi.fn(() => new Promise<void>(resolve => { complete = () => resolve(); }));
        const retry = createJournalRetry(
            () => state,
            listener => { notify = listener; return () => {}; },
            () => true, flush,
        );
        await vi.advanceTimersByTimeAsync(20_000);
        expect(flush).toHaveBeenCalledTimes(1);
        state = { ...state, syncHealth: 'synced' };
        notify();
        complete();
        await vi.advanceTimersByTimeAsync(0);
        await vi.advanceTimersByTimeAsync(600_000);
        expect(flush).toHaveBeenCalledTimes(1);
        expect(vi.getTimerCount()).toBe(0);
        retry.dispose();
    });



    it('keeps a single scheduled retry despite repeated foreground and store notifications', async () => {
        vi.useFakeTimers();
        let notify: () => void = () => {};
        const flush = vi.fn(async () => {});
        const retry = createJournalRetry(
            initial,
            listener => { notify = listener; return () => {}; },
            () => true,
            flush,
        );
        expect(vi.getTimerCount()).toBe(1);
        for (let i = 0; i < 10; i++) notify();
        retry.refresh();
        expect(vi.getTimerCount()).toBe(1);

        await vi.advanceTimersByTimeAsync(20_000);
        expect(flush).toHaveBeenCalledTimes(1);
        expect(vi.getTimerCount()).toBe(1);
        retry.dispose();
        expect(vi.getTimerCount()).toBe(0);
    });


});
