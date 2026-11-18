import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { AuthContext, defaultAuthContext, type AuthContextType } from './AuthContextDef';
import { GUEST_KEY, useGuestLogin } from './auth/useGuestLogin';
import { logoutActiveGuestSession } from './auth/logoutActiveGuestSession';
import { DB } from '../lib/db';
import { useAppStore } from '../store/useAppStore';
import { useDialogStore } from '../store/useDialogStore';
import {
    GUEST_REVOCATION_KEY, GUEST_SESSION_KEY, invalidateSession, isActiveGuestSession,
} from '../lib/sync/session';
import { readBrowserValueStrict } from '../lib/sync/browserStorage';
import { cancelLocalVaultReadiness } from '../lib/sync/secureArchiveUnlockFlow';
import { lockVault } from '../lib/sync/secureArchiveSession';

const legacyAccountUnavailable = async (): Promise<never> => {
    throw new Error('L’accesso account è gestito da Kinde. I vecchi comandi Firebase non sono disponibili.');
};

function readActiveLocalGuest(): boolean {
    return readBrowserValueStrict(GUEST_KEY) === 'true'
        && readBrowserValueStrict(GUEST_REVOCATION_KEY) === null
        && isActiveGuestSession();
}

/**
 * The live Kinde-first UI has no authenticated fitness principal yet.
 * Until the D1 vault/consent/journal path is connected, only an explicitly
 * activated, device-scoped guest may access fitness data. Never synthesize a
 * Firebase User or install an account owner from a Kinde identity-only status.
 */
export function GuestOnlyAuthProvider({ children }: { children: ReactNode }) {
    const [initialGuest] = useState(readActiveLocalGuest);
    const [isGuest, setIsGuest] = useState(initialGuest);
    const isGuestRef = useRef(initialGuest);
    const authRunRef = useRef(0);
    const logoutBusy = useRef(false);
    const [guestMigrationStatus, setGuestMigrationStatus] = useState<'idle' | 'pending' | 'failed'>('idle');
    const setUserData = useAppStore(state => state.setUserData);
    const setSaveError = useAppStore(state => state.setSaveError);

    useEffect(() => {
        const reconcile = () => {
            if (!isGuestRef.current || isActiveGuestSession()) return;
            // A remote tab's revocation cannot promote an old realm's snapshot
            // into a newly activated guest generation.
            authRunRef.current += 1;
            cancelLocalVaultReadiness('guest');
            useDialogStore.getState().cancelAll();
            lockVault('guest');
            invalidateSession();
            isGuestRef.current = false;
            setIsGuest(false);
            setGuestMigrationStatus('idle');
            useAppStore.getState().resetStore({ force: true });
        };
        const onStorage = (event: StorageEvent) => {
            if ([GUEST_KEY, GUEST_SESSION_KEY, GUEST_REVOCATION_KEY].includes(event.key ?? '')) reconcile();
        };
        const onVisible = () => {
            if (document.visibilityState === 'visible') reconcile();
        };
        window.addEventListener('storage', onStorage);
        window.addEventListener('focus', reconcile);
        document.addEventListener('visibilitychange', onVisible);
        return () => {
            authRunRef.current += 1;
            window.removeEventListener('storage', onStorage);
            window.removeEventListener('focus', reconcile);
            document.removeEventListener('visibilitychange', onVisible);
        };
    }, []);

    const readNoAuthenticatedIdentity = useCallback(() => null, []);
    const loginAsGuest = useGuestLogin({
        authRunRef, isGuestRef, setIsGuest, setGuestMigrationStatus,
        setUserData, setSaveError, readAuthIdentity: readNoAuthenticatedIdentity,
    });

    const logout = useCallback(async (options?: { mode: 'normal' | 'force'; skipConfirm?: boolean }) => {
        if (logoutBusy.current) return;
        logoutBusy.current = true;
        try {
            if (isGuestRef.current && !isActiveGuestSession()) {
                // Do not purge an archive revoked or replaced by another tab.
                authRunRef.current += 1;
                cancelLocalVaultReadiness('guest');
                lockVault('guest');
                invalidateSession();
                useDialogStore.getState().cancelAll();
                isGuestRef.current = false;
                setIsGuest(false);
                setGuestMigrationStatus('idle');
                useAppStore.getState().resetStore({ force: true });
                return;
            }
            if (!isActiveGuestSession()) return;
            await logoutActiveGuestSession({
                skipConfirm: options?.skipConfirm,
                isGuestRef, setIsGuest, setGuestMigrationStatus,
                purgeGuest: () => DB.purgeAllLocalUserData('guest'),
            });
        } finally {
            logoutBusy.current = false;
        }
    }, []);

    const value = useMemo<AuthContextType>(() => ({
        ...defaultAuthContext,
        currentUser: null,
        loading: false,
        isGuest,
        guestMigrationStatus,
        emailVerificationRequired: false,
        loginAsGuest,
        logout,
        login: legacyAccountUnavailable,
        linkGoogleAccount: legacyAccountUnavailable,
        retryGuestMigration: legacyAccountUnavailable,
        loginWithEmail: legacyAccountUnavailable,
        registerWithEmail: legacyAccountUnavailable,
        resendEmailVerification: legacyAccountUnavailable,
        refreshEmailVerification: legacyAccountUnavailable,
        continueUnverifiedLocally: legacyAccountUnavailable,
    }), [isGuest, guestMigrationStatus, loginAsGuest, logout]);

    return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}
