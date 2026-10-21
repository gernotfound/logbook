// A Google redirect returns to the initiating tab. A localStorage marker would
// let any same-origin tab clear another tab's in-flight Auth recovery.
export const AWAITING_REDIRECT_KEY = 'logbook_awaiting_redirect';

export function readAuthRedirectMarker(key: string = AWAITING_REDIRECT_KEY): string | null {
    return sessionStorage.getItem(key);
}

export function writeAuthRedirectMarker(value: 'true' | 'failed'): void {
    sessionStorage.setItem(AWAITING_REDIRECT_KEY, value);
}

export function tryRemoveAuthRedirectMarker(key: string = AWAITING_REDIRECT_KEY): boolean {
    try {
        sessionStorage.removeItem(key);
        return sessionStorage.getItem(key) === null;
    } catch {
        return false;
    }
}
