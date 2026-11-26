export function isSensitiveReauthCancellation(error: unknown): boolean {
    const code = (error as { code?: unknown } | null)?.code;
    return code === 'auth/popup-closed-by-user' || code === 'auth/cancelled-popup-request';
}
