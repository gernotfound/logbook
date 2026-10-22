// Redirect recovery is tab-scoped. A settled older SDK promise must not
// consume a marker launched by a later login attempt in the same tab.
export const AWAITING_REDIRECT_KEY = 'logbook_awaiting_redirect';
export const AWAITING_REDIRECT_ATTEMPT_KEY = 'logbook_awaiting_redirect_attempt';

export function readAuthRedirectMarker(key: string = AWAITING_REDIRECT_KEY): string | null {
    return sessionStorage.getItem(key);
}

export function readAuthRedirectAttempt(): string | null {
    return sessionStorage.getItem(AWAITING_REDIRECT_ATTEMPT_KEY);
}

export function isCurrentAuthRedirectAttempt(attempt: string | null): boolean {
    return readAuthRedirectAttempt() === attempt;
}

export function writeAuthRedirectMarker(value: 'true' | 'failed'): string | null {
    if (value === 'true') {
        const attempt = Array.from(crypto.getRandomValues(new Uint8Array(16)),
            byte => byte.toString(16).padStart(2, '0')).join('');
        // Establish generation before the active marker. If the second write
        // fails, no older reader may consume the newly claimed generation.
        sessionStorage.setItem(AWAITING_REDIRECT_ATTEMPT_KEY, attempt);
        sessionStorage.setItem(AWAITING_REDIRECT_KEY, value);
        return attempt;
    }
    sessionStorage.setItem(AWAITING_REDIRECT_KEY, value);
    return null;
}

export function tryRemoveAuthRedirectMarker(
    key: string = AWAITING_REDIRECT_KEY, expectedAttempt?: string | null,
): boolean {
    try {
        if (expectedAttempt !== undefined && !isCurrentAuthRedirectAttempt(expectedAttempt)) return false;
        sessionStorage.removeItem(key);
        if (sessionStorage.getItem(key) !== null) return false;
        sessionStorage.removeItem(AWAITING_REDIRECT_ATTEMPT_KEY);
        return sessionStorage.getItem(AWAITING_REDIRECT_ATTEMPT_KEY) === null;
    } catch {
        return false;
    }
}
