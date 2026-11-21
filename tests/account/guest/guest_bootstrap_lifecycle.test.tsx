import { auth, onAuthStateChanged, signOut } from '../../../src/lib/firebase';
import React from 'react';
import { registerLegacyGuestBootstrapCatalogCases } from './legacyGuestBootstrapCatalogCases';
import { registerLegacyGuestAuthTransitionCases } from './legacyGuestAuthTransitionCases';
import { registerLegacyGuestPurgeRecoveryCases } from './legacyGuestPurgeRecoveryCases';
import { describe, expect, beforeEach, afterEach, vi } from 'vitest';
import { waitFor } from '@testing-library/react';
import { AuthProvider } from '../../../src/contexts/AuthContext';
import { DB } from '../../../src/lib/db';
import { purgeAllLocalUserData as purgeRealLocalUserData } from '../../../src/lib/db/db_account';
import { useAuth } from '../../../src/hooks/useAuth';
import { useAppStore } from '../../../src/store/useAppStore';
import { useDialogStore } from '../../../src/store/useDialogStore';
import { clearCatalogCache, getInMemoryCatalog, getSeedCatalog, saveCatalogToCache } from '../../../src/lib/catalog/catalogService';
import { set as idbSet } from 'idb-keyval';
import { resolveEffectiveExercises, resolveEffectiveFoods } from '../../../src/lib/catalog/deltaResolver';
import { activateGuestSession, captureSession, GUEST_REVOCATION_KEY, GUEST_SESSION_KEY, isCurrentSession, invalidateSession } from '../../../src/lib/sync/session';
import { isVaultUnlocked } from '../../../src/lib/sync/secureArchiveSession';
import { withGuestLifecycleLock } from '../../../src/lib/sync/guestLifecycleLock';
import { UserDataSchema } from '../../../src/lib/schema';
import { refreshHealthConsent } from '../../../src/lib/healthConsent';
import { readAuthenticatedOwnerHint } from '../../../src/lib/sync/authOwnerHint';

/** Verify real silent encryption bootstrap rather than simulating a bypass. */
async function confirmRealGuestVault() {
    await waitFor(() => expect(isVaultUnlocked('guest')).toBe(true));
}

const GuestTestComponent = () => {
    const { currentUser, loading, isGuest, loginAsGuest, logout } = useAuth();
    const userData = useAppStore(s => s.userData);

    return (
        <div>
            <div data-testid="auth-loading">{loading ? 'LOADING' : 'READY'}</div>
            <div data-testid="auth-mode">{isGuest ? 'GUEST' : (currentUser ? 'AUTHENTICATED' : 'ANONYMOUS')}</div>
            <div data-testid="exercise-count">{userData?.library?.length ?? 0}</div>
            <div data-testid="food-count">{userData?.customFoods?.length ?? 0}</div>
            <button data-testid="btn-guest" onClick={() => loginAsGuest()}>Guest Login</button>
            <button data-testid="btn-logout" onClick={() => logout({ mode: 'normal' })}>Logout</button>
        </div>
    );
};

// Preserve the original production references and beforeEach/afterEach lifecycle.
// Scenario registrars share this entrypoint rather than duplicating Auth fixtures.
const legacyGuestContext = {
    auth, onAuthStateChanged, signOut, AuthProvider, DB, purgeRealLocalUserData,
    useAuth, useAppStore, useDialogStore, clearCatalogCache, getInMemoryCatalog,
    getSeedCatalog, saveCatalogToCache, idbSet,
    resolveEffectiveExercises, resolveEffectiveFoods,
    activateGuestSession, captureSession, GUEST_REVOCATION_KEY, GUEST_SESSION_KEY,
    isCurrentSession, invalidateSession, isVaultUnlocked, withGuestLifecycleLock,
    UserDataSchema, refreshHealthConsent, readAuthenticatedOwnerHint,
    confirmRealGuestVault, GuestTestComponent,
};
export type LegacyGuestBootstrapContext = typeof legacyGuestContext;
describe('Legacy Firebase AuthProvider: guest bootstrap and lifecycle (not public Kinde-first proof)', () => {
    afterEach(() => vi.restoreAllMocks());
    beforeEach(async () => {
        (auth as any).currentUser = null;
        vi.mocked(onAuthStateChanged).mockImplementation((_auth, callback: any) => { callback(null); return () => {}; });
        localStorage.clear();
        await clearCatalogCache();
        useAppStore.getState().resetStore();
        vi.clearAllMocks();
    });
    registerLegacyGuestBootstrapCatalogCases(legacyGuestContext);
    registerLegacyGuestAuthTransitionCases(legacyGuestContext);
    registerLegacyGuestPurgeRecoveryCases(legacyGuestContext);
});
