export type GooglePopupFailure = 'redirect' | 'cancelled' | 'network' | 'error';

export function classifyGooglePopupFailure(error: unknown): GooglePopupFailure {
    const candidate = error as { code?: unknown } | null;
    const code = typeof candidate?.code === 'string' ? candidate.code : '';

    if (code === 'auth/popup-blocked' || code === 'auth/operation-not-supported-in-this-environment') {
        return 'redirect';
    }
    if (code === 'auth/popup-closed-by-user' || code === 'auth/cancelled-popup-request') {
        return 'cancelled';
    }
    if (code === 'auth/network-request-failed') {
        return 'network';
    }
    return 'error';
}
