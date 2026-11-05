import type { User } from 'firebase/auth';
import {
    auth,
    EmailAuthProvider,
    provider,
    reauthenticateWithCredential,
    reauthenticateWithPopup,
    reauthenticateWithRedirect,
} from '../firebase';
import { captureSession, isCurrentSession } from '../sync/session';

export type SensitiveReauthResult = 'reauthenticated' | 'redirect-started' | 'password-required' | 'unsupported';

export async function reauthenticateForSensitiveAction(
    user: User,
    password?: string,
): Promise<SensitiveReauthResult> {
    const session = captureSession();
    const assertCurrent = () => {
        if (auth.currentUser?.uid !== user.uid || !isCurrentSession(session)) {
            throw new Error('Sessione cambiata. Ripeti l’operazione.');
        }
    };
    assertCurrent();
    const providerIds = new Set((user.providerData ?? []).map(item => item.providerId));

    if (providerIds.has('password') && password) {
        if (!user.email) return 'unsupported';
        await reauthenticateWithCredential(user, EmailAuthProvider.credential(user.email, password));
        assertCurrent();
        return 'reauthenticated';
    }

    if (providerIds.has('google.com')) {
        try {
            await reauthenticateWithPopup(user, provider);
            assertCurrent();
            return 'reauthenticated';
        } catch (error) {
            assertCurrent();
            const code = (error as { code?: unknown } | null)?.code;
            if (code === 'auth/popup-blocked' || code === 'auth/operation-not-supported-in-this-environment') {
                await reauthenticateWithRedirect(user, provider);
                assertCurrent();
                return 'redirect-started';
            }
            throw error;
        }
    }

    if (providerIds.has('password')) return 'password-required';
    return 'unsupported';
}

export function isSensitiveReauthCancellation(error: unknown): boolean {
    const code = (error as { code?: unknown } | null)?.code;
    return code === 'auth/popup-closed-by-user' || code === 'auth/cancelled-popup-request';
}
