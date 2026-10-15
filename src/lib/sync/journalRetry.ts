/**
 * Foreground-only, bounded retry for a durable journal already classified as
 * local-pending. No new queue: IndexedDB stays authoritative. Callers must
 * gate account identity, connectivity and verified cloud consent.
 */
export type JournalRetryHealth = 'saving' | 'synced' | 'local-pending' | 'rejected' | 'failed';
export interface JournalRetryState {
    syncHealth: JournalRetryHealth;
    syncing: boolean;
    localPersistenceBlocked: boolean;
    compatibilityStatus: string;
}
export function createJournalRetry(
    readState: () => JournalRetryState,
    subscribe: (listener: () => void) => () => void,
    eligible: () => boolean,
    flush: () => Promise<void>,
) {
    let timer: ReturnType<typeof setTimeout> | null = null;
    let attempts = 0;
    let active = false;
    let disposed = false;
    const clear = () => {
        if (timer !== null) clearTimeout(timer);
        timer = null;
    };
    const canSchedule = () => {
        const state = readState();
        return state.syncHealth === 'local-pending' && !state.syncing && !state.localPersistenceBlocked
            && state.compatibilityStatus !== 'update-required' && eligible();
    };
    const schedule = () => {
        if (disposed || timer !== null || active || !canSchedule()) return;
        const delay = Math.min(20_000 * 2 ** Math.min(attempts, 4), 300_000);
        timer = setTimeout(() => {
            timer = null;
            if (!canSchedule() || disposed) return;
            active = true;
            attempts += 1;
            void Promise.resolve().then(flush).catch(error => {
                console.warn('Retry journal in primo piano non completato:', error);
            }).finally(() => {
                active = false;
                schedule();
            });
        }, delay);
    };
    const unsubscribe = subscribe(() => {
        const state = readState();
        if (state.syncHealth === 'synced' || state.syncHealth === 'failed'
            || state.syncHealth === 'rejected' || state.localPersistenceBlocked
            || state.compatibilityStatus === 'update-required') {
            attempts = 0;
            clear();
        } else if (state.syncHealth === 'saving' || state.syncing || !eligible()) {
            clear();
        } else {
            schedule();
        }
    });
    schedule();
    return {
        /** Foreground/online event: let the caller flush immediately, without waiting for a backoff timer. */
        reset: () => { attempts = 0; clear(); },
        refresh: () => { schedule(); },
        dispose: () => { disposed = true; clear(); unsubscribe(); },
    };
}
