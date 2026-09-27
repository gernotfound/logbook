import type { User } from 'firebase/auth';
import {
    EmailAuthProvider,
    provider,
    reauthenticateWithCredential,
    reauthenticateWithPopup,
} from '../firebase';

export type SensitiveReauthResult = 'reauthenticated' | 'password-required' | 'unsupported';

export async function reauthenticateForSensitiveAction(
    user: User,
    password?: string,
): Promise<SensitiveReauthResult> {
    const providerIds = new Set((user.providerData ?? []).map(item => item.providerId));

    if (providerIds.has('password') && password) {
        if (!user.email) return 'unsupported';
        await reauthenticateWithCredential(user, EmailAuthProvider.credential(user.email, password));
        return 'reauthenticated';
    }

    if (providerIds.has('google.com')) {
        await reauthenticateWithPopup(user, provider);
        return 'reauthenticated';
    }

    if (providerIds.has('password')) return 'password-required';
    return 'unsupported';
}

export function isSensitiveReauthCancellation(error: unknown): boolean {
    const code = (error as { code?: unknown } | null)?.code;
    return code === 'auth/popup-closed-by-user' || code === 'auth/cancelled-popup-request';
}
