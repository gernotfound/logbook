import { useCallback, type Dispatch, type RefObject, type SetStateAction } from 'react';
import { captureAuthAttemptGuard } from '../../lib/auth/authAttemptGuard';
import { auth } from '../../lib/firebase';
import { DB } from '../../lib/db';
import { useAppStore } from '../../store/useAppStore';
import { useDialogStore } from '../../store/useDialogStore';
import { UserDataSchema } from '../../lib/schema';
import type { UserData } from '../../types';
import { getCachedCatalog, getInMemoryCatalog, isCatalogInMemory } from '../../lib/catalog/catalogService';
import { resolveEffectiveExercises, resolveEffectiveFoods } from '../../lib/catalog/deltaResolver';
import { getResolvedDefaultUserData } from './defaultUserData';
import { activateGuestSession, captureSession, isCurrentSession, type SessionSnapshot, GUEST_REVOCATION_KEY, GUEST_SESSION_KEY } from '../../lib/sync/session';
import { withGuestLifecycleLock } from '../../lib/sync/guestLifecycleLock';
import { readBrowserValueStrict, removeBrowserValue, writeBrowserValue } from '../../lib/sync/browserStorage';
import { clearAuthenticatedOwnerHint } from '../../lib/sync/authOwnerHint';
import { ensureLocalVaultReady } from '../../lib/sync/secureArchiveUnlockFlow';
import { isVaultUnlocked } from '../../lib/sync/secureArchiveSession';

export const GUEST_KEY = 'logbook_is_guest';

/** The same guard used at both asynchronous guest bootstrap boundaries. */
export function isGuestVaultReadinessCurrent(
    session: SessionSnapshot,
    vaultReady: (owner: string) => boolean = isVaultUnlocked,
): boolean {
    return session.owner === 'guest' && isCurrentSession(session) && vaultReady('guest');
}

type GuestMigrationStatus = 'idle' | 'pending' | 'failed';
type GuestLoginDependencies = {
    isGuestRef: RefObject<boolean>;
    setIsGuest: Dispatch<SetStateAction<boolean>>;
    setGuestMigrationStatus: Dispatch<SetStateAction<GuestMigrationStatus>>;
    setUserData: ReturnType<typeof useAppStore.getState>['setUserData'];
    setSaveError: ReturnType<typeof useAppStore.getState>['setSaveError'];
};

// The provider owns Auth state. This hook preserves the guest generation lock,
// archive cleanup and vault readiness before publishing guest data.
export function useGuestLogin({
    isGuestRef, setIsGuest, setGuestMigrationStatus, setUserData, setSaveError,
}: GuestLoginDependencies) {
    const loginAsGuest = useCallback(async () => {
        const originalUser = auth.currentUser;
        const originalEpoch = captureSession().epoch;
        const originalGuard = captureAuthAttemptGuard(false);
        const isOriginalAttemptCurrent = () => {
            const current = originalGuard();
            if (!current) console.warn('AUDIT_GUEST_START_GUARD', {
                sameAuth: auth.currentUser === originalUser,
                originalEpoch, currentEpoch: captureSession().epoch,
            });
            return current;
        };
        const activation: { session: SessionSnapshot | null } = { session: null };
        try {
            // Serialize the entire cleanup-to-activation transition across tabs.
            // An older logout must never delete a new guest generation.
            await withGuestLifecycleLock(async () => {
                if (!isOriginalAttemptCurrent()) return;
                clearAuthenticatedOwnerHint();
                if (readBrowserValueStrict(GUEST_REVOCATION_KEY) !== null) {
                    await DB.purgeAllLocalUserData('guest');
                    if (!isOriginalAttemptCurrent()) return;
                    // This realm might still hold the revoked guest's snapshot.
                    // Do not seed the new generation with data from that session.
                    useAppStore.getState().resetStore({ force: true });
                }
                const bytes = crypto.getRandomValues(new Uint8Array(16));
                const id = Array.from(bytes, byte => byte.toString(16).padStart(2, '0')).join('');
                writeBrowserValue(GUEST_SESSION_KEY, id);
                writeBrowserValue(GUEST_KEY, 'true');
                removeBrowserValue(GUEST_REVOCATION_KEY);
                activateGuestSession(id);
                // Capture under the lock: Auth may change before its Promise
                // resumes, so the caller cannot capture a newer epoch as its own.
                activation.session = captureSession();
                useDialogStore.getState().cancelAll();
            });
        } catch {
            if (!isOriginalAttemptCurrent() && (!activation.session || !isCurrentSession(activation.session))) return;
            setSaveError('Impossibile avviare la modalità locale: pulizia o coordinamento delle sessioni non disponibile. I dati esistenti restano protetti.');
            return;
        }
        // Guest activation and vault provisioning are separate awaits. A
        // logout, account switch or other tab may revoke this generation
        // before the vault is ready. Never promote a stale guest into Zustand.
        if (!activation.session || activation.session.owner !== 'guest' || !isCurrentSession(activation.session)) {
            console.warn('AUDIT_GUEST_ACTIVATION_GUARD', {
                captured: activation.session, current: captureSession(),
                sameAuth: auth.currentUser === originalUser,
            });
            return;
        }
        const guestSession = activation.session;
        const canPublishGuest = () => isGuestVaultReadinessCurrent(guestSession);
        await ensureLocalVaultReady('guest');
        // A cancelled readiness Promise may resolve without an unlocked vault.
        if (!canPublishGuest()) return;
        const previous = useAppStore.getState();
        // An ownerless/foreign snapshot must not seed a new guest generation.
        if ((previous.userData !== null || previous.localWorkout !== null) && previous.dataOwner !== 'guest') {
            previous.resetStore({ force: true });
        }
        const currentData = useAppStore.getState().userData;
        let nextData: UserData | null = null;
        if (!currentData) {
            const catalog = isCatalogInMemory() ? getInMemoryCatalog() : (await getCachedCatalog());
            nextData = UserDataSchema.parse(getResolvedDefaultUserData(catalog)) as unknown as UserData;
        } else {
            const hasCatalogExercises = Array.isArray(currentData.library) && currentData.library.some(e => e.isDefault === true);
            const hasCatalogFoods = Array.isArray(currentData.customFoods) && currentData.customFoods.some(f => f.isCustom === false);
            if (!hasCatalogExercises || !hasCatalogFoods) {
                const catalog = isCatalogInMemory() ? getInMemoryCatalog() : (await getCachedCatalog());
                const resolvedLibrary = !hasCatalogExercises
                    ? resolveEffectiveExercises(catalog.exercises, currentData.library || [], currentData.catalogOverrides)
                    : currentData.library;
                const resolvedFoods = !hasCatalogFoods
                    ? resolveEffectiveFoods(catalog.foods, currentData.customFoods || [], currentData.catalogOverrides)
                    : currentData.customFoods;
                nextData = {
                    ...currentData,
                    library: resolvedLibrary,
                    customFoods: resolvedFoods,
                };
            }
        }
        // The catalog may have awaited while another account was activated.
        // Publish the guest flag and its data only after the same final check.
        if (!canPublishGuest()) return;
        isGuestRef.current = true;
        setIsGuest(true);
        setGuestMigrationStatus('idle');
        if (nextData) setUserData(nextData);
    }, [isGuestRef, setIsGuest, setGuestMigrationStatus, setSaveError, setUserData]);

    return loginAsGuest;
}
