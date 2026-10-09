/**
 * Serialize destructive guest cleanup and new guest session activation across
 * browser tabs. The native origin-scoped Web Locks API is required: an
 * in-memory mutex cannot protect data shared by multiple tabs or PWA windows.
 */
export function withGuestLifecycleLock<T>(operation: () => Promise<T>): Promise<T> {
    if (typeof navigator === 'undefined' || !navigator.locks?.request) {
        throw new Error('Coordinamento sicuro delle sessioni locali non disponibile su questo browser.');
    }
    return navigator.locks.request('thelogbook:guest-lifecycle', { mode: 'exclusive' }, operation);
}
