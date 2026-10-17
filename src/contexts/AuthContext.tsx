import { useState, useEffect, useRef, useCallback, useMemo, ReactNode } from 'react';
import { User } from 'firebase/auth';
import { auth, getRedirectResult, onAuthStateChanged, signOut } from '../lib/firebase';
import { DB } from '../lib/db';
import { isAccountDeletionPending } from '../lib/sync/accountGate';
import { refreshHealthConsent } from '../lib/healthConsent';
import { useAppStore } from '../store/useAppStore';
import { UserData } from '../types';
import { AuthContext, type GuestMigrationPolicy } from './AuthContextDef';
import { useDialogStore } from '../store/useDialogStore';
import { draftRegistry } from '../lib/utils/draftRegistry';
import { useEmailAuthActions } from './auth/useEmailAuthActions';
import { useGoogleAuthActions } from './auth/useGoogleAuthActions';
import { useGuestMigrationRetry } from './auth/useGuestMigrationRetry';
import { GUEST_KEY, useGuestLogin } from './auth/useGuestLogin';
import { resumePersistedGuestMigration } from './auth/resumePersistedGuestMigration';
import { guardAuthenticatedBootstrap } from './auth/guardAuthenticatedBootstrap';
import { createAuthConsentLifecycleHandlers } from './auth/consentLifecycle';
import { loadAuthenticatedData } from './auth/loadAuthenticatedData';
import { migrateGuestAccount } from './auth/migrateGuestAccount';
import { isLegalConsentRequiredError } from '../lib/sync/replicateJournal';
import { captureSession, GUEST_REVOCATION_KEY, GUEST_SESSION_KEY, invalidateSession, isActiveGuestSession, isCurrentSession, revokeGuestSession, userOwner } from '../lib/sync/session';
import { classifySyncFailure } from '../lib/sync/syncFailure';
import { withGuestLifecycleLock } from '../lib/sync/guestLifecycleLock';
import { SyncTimeoutError } from '../lib/db/db_core';
import {
    BrowserStorageError,
    readBrowserValue,
    readBrowserValueStrict,
    removeBrowserValue,
    tryRemoveBrowserValue,
    writeBrowserValue,
} from '../lib/sync/browserStorage';
import { safeHardReload } from '../lib/sync/safeReload';
import { prepareForReload } from '../lib/sync/reloadBarrier';
import { watchDeletionRecoveryDeviceRegistration } from '../lib/deletionDeviceRecovery';
import { RecoveryDiagnosticTracker } from '../lib/deletionRecoveryDiagnostics';
import { reportError } from '../lib/errorHandler';
import { clearAuthenticatedOwnerHint } from '../lib/sync/authOwnerHint';
import { bindGuestMigrationIntentToUser, clearGuestMigrationIntent } from '../lib/auth/guestMigrationIntent';
import { cancelLocalVaultReadiness, ensureLocalVaultReady } from '../lib/sync/secureArchiveUnlockFlow';
import { lockVault } from '../lib/sync/secureArchiveSession';

const GUEST_MIGRATION_SYNC_RECOVERY_KEY = 'logbook_guest_migration_sync_recovery';
const AWAITING_REDIRECT_KEY = 'logbook_awaiting_redirect';

function isStoredGuest(): boolean {
    return readBrowserValueStrict(GUEST_KEY) === 'true' && readBrowserValueStrict(GUEST_REVOCATION_KEY) === null && isActiveGuestSession();
}

function readGuestMigrationSyncRecovery(): string | null {
    return readBrowserValueStrict(GUEST_MIGRATION_SYNC_RECOVERY_KEY);
}

function markGuestMigrationSyncRecovery(uid: string): void {
    writeBrowserValue(GUEST_MIGRATION_SYNC_RECOVERY_KEY, uid);
}

function clearGuestMigrationSyncRecovery(uid: string): void {
    if (readBrowserValueStrict(GUEST_MIGRATION_SYNC_RECOVERY_KEY) === uid) {
        removeBrowserValue(GUEST_MIGRATION_SYNC_RECOVERY_KEY);
    }
}

export const AuthProvider = ({ children }: { children: ReactNode }) => {
    const [currentUser, setCurrentUser] = useState<User | null>(null);
    const [loading, setLoading] = useState(true);

    // Read persisted guest ownership only at mount. A useRef(initializer) expression
    // is evaluated again on every render even though React ignores later values; a
    // storage failure that appears after mount must be handled by the strict lifecycle
    // gates below, not by throwing during an unrelated React render.
    const [initialGuestMode] = useState(() => isStoredGuest());
    const isGuestRef = useRef(initialGuestMode);
    const [isGuest, setIsGuest] = useState(initialGuestMode);
    const [guestMigrationStatus, setGuestMigrationStatus] = useState<'idle' | 'pending' | 'failed'>('idle');
    const [emailVerificationRequired, setEmailVerificationRequired] = useState(false);

    // Dati da migrare da guest a Google al momento del link
    const migrationDataRef = useRef<UserData | null>(null);
    const authRunRef = useRef(0);
    const authUidRef = useRef(auth.currentUser?.uid ?? null);
    const redirectLaunchFailedRef = useRef(false);

    const setUserData = useAppStore(state => state.setUserData);
    const setSyncing = useAppStore(state => state.setSyncing);
    const setSaveError = useAppStore(state => state.setSaveError);

    useEffect(() => {
        const reconcileGuestSession = () => {
            if (!isGuestRef.current || isActiveGuestSession()) return;
            // A different tab explicitly revoked this guest generation.
            // Never recreate its deleted data from the old Zustand snapshot.
            cancelLocalVaultReadiness('guest');
            useDialogStore.getState().cancelAll();
            lockVault('guest');
            invalidateSession();
            isGuestRef.current = false;
            setIsGuest(false);
            setGuestMigrationStatus('idle');
            useAppStore.getState().resetStore({ force: true });
            DB.resetCache();
        };
        const onStorage = (event: StorageEvent) => {
            if (event.key === GUEST_REVOCATION_KEY || event.key === GUEST_SESSION_KEY || event.key === GUEST_KEY) {
                reconcileGuestSession();
            }
        };
        const onForeground = () => { if (document.visibilityState === 'visible') reconcileGuestSession(); };
        window.addEventListener('storage', onStorage);
        window.addEventListener('focus', reconcileGuestSession);
        document.addEventListener('visibilitychange', onForeground);
        return () => {
            window.removeEventListener('storage', onStorage);
            window.removeEventListener('focus', reconcileGuestSession);
            document.removeEventListener('visibilitychange', onForeground);
        };
    }, []);


    const blockUnreadableLifecycleStorage = useCallback((error: unknown): never => {
        console.error('Lifecycle Auth bloccato: ownership storage non leggibile.', error);
        useAppStore.setState({
            userData: null,
            dataOwner: null,
            localWorkout: null,
            localPersistenceBlocked: true,
            syncHealth: 'failed',
            saveError: 'Archivio del dispositivo non disponibile. TheLogBook non può determinare in sicurezza a chi appartengono i dati locali.',
        });
        setLoading(false);
        throw error;
    }, []);

    const isGuestActiveStrict = useCallback((): boolean => {
        try {
            return (isGuestRef.current || isStoredGuest()) && isActiveGuestSession();
        } catch (error) {
            return blockUnreadableLifecycleStorage(error);
        }
    }, [blockUnreadableLifecycleStorage]);

    const readGuestMigrationRecoveryStrict = useCallback((): string | null => {
        try {
            return readGuestMigrationSyncRecovery();
        } catch (error) {
            return blockUnreadableLifecycleStorage(error);
        }
    }, [blockUnreadableLifecycleStorage]);

    const loadData = useCallback(async (user: User) => {
        await loadAuthenticatedData({
            user,
            isGuestActive: () => isGuestActiveStrict(),
            setUserData,
            setSyncing,
            setSaveError,
        });

        if (typeof navigator !== 'undefined' && !navigator.onLine) return;
        if (auth.currentUser?.uid !== user.uid || isGuestActiveStrict()) return;

        const { readLocal } = await import('../lib/sync/localRepository');
        const drainCheckpointedJournal = async () => {
            const envelope = await readLocal(user.uid);
            if (!envelope?.replica || !envelope.pending.length) return;
            await useAppStore.getState().flushPendingSyncs();
        };

        // A Protocol 3 checkpoint can be the prerequisite that makes an offline or
        // migrated journal deliverable. Drain it after the checkpoint instead of
        // relying on listener ordering between the global replay and auth refresh.
        try {
            await drainCheckpointedJournal();
        } catch (error) {
            if ((error as { code?: unknown })?.code !== 'replica-fenced') throw error;

            // transactionWriter has already marked the durable identity as checkpoint-required.
            // Re-enter the authenticated loader once: it performs a full cloud scan, obtains
            // a current generation, rebases the journal, then the retry can be delivered.
            await loadAuthenticatedData({
                user,
                isGuestActive: () => isGuestActiveStrict(),
                setUserData,
                setSyncing,
                setSaveError,
            });
            await drainCheckpointedJournal();
        }
    }, [isGuestActiveStrict, setSyncing, setUserData, setSaveError]);

    useEffect(() => {
        if (!currentUser || emailVerificationRequired) return;
        const diagnostics = new RecoveryDiagnosticTracker();
        return watchDeletionRecoveryDeviceRegistration(
            currentUser,
            error => {
                diagnostics.recordFailure('device-registration', error, (summary, source) => {
                    reportError(summary, { source });
                    console.warn('Registrazione recovery device: diagnostica tecnica:', summary.message);
                });
            },
            () => diagnostics.recordSuccess('device-registration'),
        );
    }, [currentUser, emailVerificationRequired]);

    useEffect(() => {
        if (!currentUser || guestMigrationStatus === 'idle') return;

        const appContainer = document.getElementById('app-container');
        const parent = appContainer?.parentElement;
        if (!appContainer || !parent) return;

        const authOverlay = Array.from(parent.children).find(
            element => element instanceof HTMLElement && element.id === 'auth-overlay'
        );
        const background = Array.from(parent.children).filter(
            (element): element is HTMLElement => element instanceof HTMLElement && element !== authOverlay
        );
        const previousInert = background.map(element => element.inert);

        background.forEach(element => { element.inert = true; });

        return () => {
            background.forEach((element, index) => { element.inert = previousInert[index]; });
        };
    }, [currentUser, guestMigrationStatus]);

    useEffect(() => {
        let isMounted = true;
        const handleAuthVisibilityChange = async () => {
            if (redirectLaunchFailedRef.current) return;
            if (document.visibilityState !== 'visible' || readBrowserValue(AWAITING_REDIRECT_KEY) !== 'true') return;
            if (!tryRemoveBrowserValue(AWAITING_REDIRECT_KEY)) {
                setSaveError('Accesso completato, ma non riesco ad aggiornare lo stato locale del dispositivo. Riprova.');
                return;
            }
            try {
                await safeHardReload();
            } catch (error) {
                console.warn('Reload post-auth bloccato dalla barriera di persistenza:', error);
                setSaveError(error instanceof Error ? error.message : 'Ricaricamento non sicuro. Riprova.');
            }
        };
        document.addEventListener('visibilitychange', handleAuthVisibilityChange);

        getRedirectResult(auth).then(() => {
            tryRemoveBrowserValue(AWAITING_REDIRECT_KEY);
        }).catch(() => {
            tryRemoveBrowserValue(AWAITING_REDIRECT_KEY);
            console.error('Ripresa redirect Google non riuscita.');
            setSaveError("Accesso Google non completato. Riprova.");
        });

        const unsubscribe = onAuthStateChanged(auth, async (user: any) => {
            if (!isMounted) return;

            try {
            const nextUid = user?.uid ?? null;
            const previousUid = authUidRef.current;
            authUidRef.current = nextUid;
            const authRun = ++authRunRef.current;
            if (previousUid !== nextUid) {
                useDialogStore.getState().cancelAll();
                // Do not carry an account's unlocked DEK into another identity.
                // A guest->account migration keeps its separate guest vault until
                // the verified migration has completed.
                if (previousUid) {
                    cancelLocalVaultReadiness(userOwner(previousUid));
                    lockVault(userOwner(previousUid));
                }
                invalidateSession();
            }
            setSyncing(false);
            if (previousUid !== nextUid) setLoading(true);
            const expectedUid = nextUid;
            const isCurrentRun = () => isMounted
                && authRunRef.current === authRun
                && (expectedUid ? auth.currentUser?.uid === expectedUid : auth.currentUser === null);

            if (user && guardAuthenticatedBootstrap(user, {
                awaitingRedirectKey: AWAITING_REDIRECT_KEY,
                isGuestActiveStrict, setCurrentUser, setEmailVerificationRequired,
                setGuestMigrationStatus, setLoading,
            })) return;
            // A deletion receipt is independently recoverable even while the
            // ciphertext is locked. Do not require the secret of an account
            // already deleted on the server just to finalize its local purge.
            if (user && isAccountDeletionPending(userOwner(user.uid))) {
                useAppStore.getState().cancelPendingSyncs();
                useAppStore.setState({ userData: null, dataOwner: null, localWorkout: null });
                setCurrentUser(user);
                setLoading(false);
                return;
            }
            // Consent refresh itself performs a durable IndexedDB consent-epoch
            // update. Unlock BEFORE it, not merely before later hydration/sync.
            if (user) {
                await ensureLocalVaultReady(userOwner(user.uid));
                if (!isCurrentRun()) return;
            }
            // Expose identity only after the local archive can be safely read.
            if (user) setEmailVerificationRequired(false);
            setCurrentUser(user);
            if (user) {
                // Hydration/migration and all cloud business writes must wait for
                // this check; an offline/failed check remains fail-closed.
                const consentStatus = await refreshHealthConsent(user);
                if (!isCurrentRun()) return;
                if (consentStatus !== 'active') {
                    // No regular hydration/migration/replica registration after a
                    // withdrawal, even when a local cached envelope exists.
                    useAppStore.getState().cancelPendingSyncs();
                    setLoading(false);
                    return;
                }
            }

            if (user) {
                const wasGuest = isGuestActiveStrict();
                setEmailVerificationRequired(false);
                const recoveryUid = readGuestMigrationRecoveryStrict();

                if (recoveryUid === user.uid) {
                    setLoading(false);
                    const handled = await resumePersistedGuestMigration(user, isCurrentRun, {
                        guestKey: GUEST_KEY,
                        isGuestActiveStrict, isGuestRef, migrationDataRef, setIsGuest,
                        setGuestMigrationStatus, setUserData, setSyncing, setSaveError,
                        clearGuestMigrationSyncRecovery,
                    });
                    if (!isCurrentRun()) return;
                    if (handled) return;
                }

                if (wasGuest) {
                    setGuestMigrationStatus('pending');
                    setLoading(false);
                    draftRegistry.flushAll();

                    const guestData = migrationDataRef.current || useAppStore.getState().userData;
                    let policy: GuestMigrationPolicy;
                    let intentId: string;
                    try {
                        const intent = bindGuestMigrationIntentToUser(user);
                        policy = intent.policy;
                        intentId = intent.id;
                    } catch (error) {
                        if (!isCurrentRun()) return;
                        console.error('Intento migrazione guest non determinabile:', error);
                        setGuestMigrationStatus('failed');
                        setSaveError('Non è possibile determinare il tentativo di trasferimento. Avvia di nuovo l’accesso e scegli come gestire i dati locali.');
                        return;
                    }

                    try {
                        const migrationResult = await migrateGuestAccount({
                            user,
                            guestData,
                            policy,
                            setUserData,
                            setSyncing,
                            isCurrent: isCurrentRun,
                            onLocalReady: () => {
                                // Persist recovery before changing owner. If any critical
                                // storage transition fails, migration remains recoverable.
                                markGuestMigrationSyncRecovery(user.uid);
                                removeBrowserValue(GUEST_KEY);
                                clearGuestMigrationIntent(intentId);
                                isGuestRef.current = false;
                                setIsGuest(false);
                                migrationDataRef.current = null;
                            },
                        });

                        if (!isCurrentRun()) return;

                        if (migrationResult.status === 'rejected' || migrationResult.status === 'failed') {
                            setGuestMigrationStatus('failed');
                            setSaveError('I dati sono salvati su questo dispositivo, ma la sincronizzazione dell’account non è stata completata. Riprova.');
                        } else {
                            clearGuestMigrationSyncRecovery(user.uid);
                            setGuestMigrationStatus('idle');
                            if (migrationResult.status === 'local-pending') {
                                setSaveError(isLegalConsentRequiredError(migrationResult.error)
                                    ? 'Account preparato sul dispositivo. Accetta Termini e consenso salute per sincronizzare i progressi.'
                                    : '📶 Offline: account preparato sul dispositivo. La sincronizzazione riprenderà quando torni online.');
                            }
                        }
                    } catch (error) {
                        if (!isCurrentRun()) return;
                        console.error('Preparazione account da modalità locale non completata:', error);
                        setGuestMigrationStatus('failed');
                        setSaveError('Preparazione account non completata. I dati locali sono conservati e possono essere recuperati. Riprova.');
                    }
                } else {
                    setGuestMigrationStatus('idle');
                    await loadData(user);
                    if (isCurrentRun()) setLoading(false);
                }
            } else {
                setCurrentUser(null);
                setEmailVerificationRequired(false);
                setGuestMigrationStatus('idle');
                if (previousUid) {
                    try { clearAuthenticatedOwnerHint(userOwner(previousUid)); }
                    catch (error) { console.warn('Hint autenticato non ripulito dopo sign-out:', error); }
                }
                const isGuestActive = isGuestActiveStrict();
                if (!isGuestActive) {
                    try {
                        clearAuthenticatedOwnerHint();
                    } catch (error) {
                        console.warn('Impossibile pulire l’owner autenticato locale:', error);
                    }
                    DB.resetCache();
                    useAppStore.getState().resetStore();
                }
                if (isCurrentRun()) setLoading(false);
            }
            } catch (error) {
                if (error instanceof BrowserStorageError) return;
                throw error;
            }
        });

        const { handleConsentReactivated, handleVisibilityChange, handleOffline } = createAuthConsentLifecycleHandlers({
            isMounted: () => isMounted,
            isGuestActiveStrict, loadData, setLoading, setSaveError,
        });
        document.addEventListener('visibilitychange', handleVisibilityChange);
        window.addEventListener('online', handleVisibilityChange);
        window.addEventListener('focus', handleVisibilityChange);
        window.addEventListener('offline', handleOffline);

        return () => {
            isMounted = false;
            authRunRef.current += 1;
            // A pending automatic vault operation or failure dialog belongs to
            // THIS auth provider lifecycle. Never strand it above later login,
            // consent, update or account-deletion screens after unmount.
            if (authUidRef.current) cancelLocalVaultReadiness(userOwner(authUidRef.current));
            cancelLocalVaultReadiness('guest');
            invalidateSession();
            unsubscribe();
            document.removeEventListener('visibilitychange', handleAuthVisibilityChange);
            document.removeEventListener('visibilitychange', handleVisibilityChange);
            window.removeEventListener('online', handleVisibilityChange);
            window.removeEventListener('focus', handleVisibilityChange);
            window.removeEventListener('offline', handleOffline);
            window.removeEventListener('logbook:health-consent-reactivated', handleConsentReactivated);
        };
    }, [isGuestActiveStrict, loadData, readGuestMigrationRecoveryStrict, setSyncing, setUserData, setSaveError]);

    const { login, linkGoogleAccount } = useGoogleAuthActions({
        isGuestActiveStrict, setSaveError, migrationDataRef, redirectLaunchFailedRef,
    });

    const { loginWithEmail, registerWithEmail, resendEmailVerification, refreshEmailVerification } = useEmailAuthActions({
        isGuestActiveStrict, setSaveError, setEmailVerificationRequired, migrationDataRef,
    });

    const loginAsGuest = useGuestLogin({
        isGuestRef, setIsGuest, setGuestMigrationStatus, setUserData, setSaveError,
    });

    const continueUnverifiedLocally = useCallback(async () => {
        const user = auth.currentUser;
        if (!user || user.emailVerified !== false) {
            throw new Error('Nessuna verifica email in attesa.');
        }
        // Reconcile any in-memory edits and device-critical drafts before switching
        // owner; a failed durability check must leave the account session intact.
        const current = useAppStore.getState();
        if (current.userData !== null || current.localWorkout !== null) {
            await prepareForReload();
        }
        // Sign out without the authenticated purge path: local owner envelopes and
        // any guest migration intent must survive until an explicit verified login.
        await signOut(auth);
        lockVault(userOwner(user.uid));
        if (!isGuestActiveStrict()) {
            // Never seed a fresh guest from another authenticated user's in-memory data.
            // resetStore does not delete the authenticated IndexedDB envelope.
            useAppStore.getState().resetStore({ force: true });
            await loginAsGuest();
        }
    }, [isGuestActiveStrict, loginAsGuest]);

    const retryGuestMigration = useGuestMigrationRetry({
        isGuestActiveStrict, setSaveError, setSyncing,
        setGuestMigrationStatus, clearGuestMigrationSyncRecovery,
    });

    const logoutInFlightRef = useRef(false);
    const LOGOUT_SYNC_CHECK_TIMEOUT_MS = 5000;

    const logout = useCallback(async (options?: { mode?: 'normal' | 'force', skipConfirm?: boolean }) => {
        if (logoutInFlightRef.current) return;
        logoutInFlightRef.current = true;

        try {
            const skipConfirm = options?.skipConfirm;
            const mode = options?.mode || 'normal';
            const initialUid = auth.currentUser?.uid;

            // A remote logout can revoke this tab before its storage event is
            // delivered. Never fall through to the authenticated purge path.
            if (isGuestRef.current && !isActiveGuestSession()) {
                invalidateSession();
                isGuestRef.current = false;
                setIsGuest(false);
                useAppStore.getState().resetStore({ force: true });
                if (initialUid) {
                    try { await signOut(auth); }
                    catch { await useDialogStore.getState().showAlert('Uscita dall’account non riuscita. Riprova.'); }
                }
                return;
            }

            if (initialUid && isGuestActiveStrict()) {
                // During deferred guest migration, signing out Firebase must not
                // revoke or purge the still-owned guest archive.
                try { await signOut(auth); }
                catch { await useDialogStore.getState().showAlert('Uscita dall’account non riuscita. Riprova.'); }
                return;
            }

            if (isGuestActiveStrict()) {
                const requestedSession = captureSession();
                if (!skipConfirm) {
                    const confirmed = await useDialogStore.getState().showConfirm(
                        "Sei in modalità locale. Se esci, i tuoi dati su questo dispositivo andranno persi definitivamente e non potranno essere recuperati.\n\nSei sicuro di voler continuare?"
                    );
                    if (!confirmed) return;
                }

                let purgeError: unknown;
                try {
                    await withGuestLifecycleLock(async () => {
                        // Confirmation and lock acquisition are both asynchronous.
                        // A different tab may have replaced or revoked this generation.
                        if (!isCurrentSession(requestedSession)) return;
                        revokeGuestSession();
                        useDialogStore.getState().cancelAll();
                        useAppStore.getState().cancelPendingSyncs();
                        try {
                            await DB.purgeAllLocalUserData('guest');
                            // Keep the public logout postcondition explicit.
                            removeBrowserValue(GUEST_KEY);
                            removeBrowserValue(GUEST_SESSION_KEY);
                        } catch (error) {
                            purgeError = error;
                        }
                        if (initialUid) clearGuestMigrationSyncRecovery(initialUid);
                        isGuestRef.current = false;
                        setIsGuest(false);
                        setGuestMigrationStatus('idle');
                        useAppStore.getState().resetStore({ force: true });
                    });
                } catch {
                    await useDialogStore.getState().showAlert(
                        'Impossibile coordinare la chiusura della modalità locale. Nessuna nuova cancellazione viene avviata senza la protezione tra schede.'
                    );
                    return;
                }
                if (purgeError) {
                    await useDialogStore.getState().showAlert(
                        'Uscita dalla modalità locale, ma pulizia del dispositivo incompleta. I dati rimasti non sono accessibili dalla vecchia sessione; riprova dopo aver riaperto LogBook.'
                    );
                }
                return;
            }

            if (initialUid && isAccountDeletionPending(userOwner(initialUid))) {
                await useDialogStore.getState().showAlert('Cancellazione account ancora in corso. I dati locali sono protetti: completa prima il recupero della cancellazione.');
                return;
            }

            if (useAppStore.getState().localPersistenceBlocked) {
                await useDialogStore.getState().showAlert('Le ultime modifiche sul dispositivo non risultano salvate. Per evitare di perderle, il logout è bloccato: riapri TheLogBook e verifica il recupero.');
                return;
            }

            let discardUnsynced = mode === 'force';
            if (mode === 'normal') {
                setSyncing(true);
                // The Firestore SDK tracks only its own in-flight writes, not
                // TheLogBook's IndexedDB journal. Inspect the durable source.
                let durablePending = false;
                try {
                    const { readLocal } = await import('../lib/sync/localRepository');
                    const envelope = await readLocal(userOwner(initialUid!));
                    durablePending = (envelope?.pending.length ?? 0) > 0;
                } catch {
                    setSyncing(false);
                    await useDialogStore.getState().showAlert('Non posso verificare i dati locali prima del logout. Archivio preservato: riprova dopo aver riaperto TheLogBook.');
                    return;
                }
                const state = useAppStore.getState();
                let isSafe = state.syncHealth === 'synced' && !state.localWorkout && !state.userData?.pendingConflicts && !durablePending;
                let pendingWriteStatus: 'local-pending' | 'rejected' | 'failed' | null = null;

                if (!isSafe) {
                    try {
                        const { waitForPendingWrites } = await import('firebase/firestore');
                        const { getDb } = await import('../lib/firebase');

                        const timeoutPromise = new Promise((_, reject) => setTimeout(
                            () => reject(new SyncTimeoutError('Controllo sincronizzazione logout scaduto')),
                            LOGOUT_SYNC_CHECK_TIMEOUT_MS
                        ));
                        await Promise.race([waitForPendingWrites(getDb()), timeoutPromise]);
                    } catch (error) {
                        const failure = classifySyncFailure(error);
                        pendingWriteStatus = failure.status;
                        if (failure.status !== 'local-pending') {
                            console.warn('Controllo scritture pendenti durante logout fallito:', error);
                        }
                    }

                    if (auth.currentUser?.uid !== initialUid) {
                        setSyncing(false);
                        return;
                    }

                    const finalState = useAppStore.getState();
                    isSafe = finalState.syncHealth === 'synced' && !finalState.localWorkout && !finalState.userData?.pendingConflicts && !durablePending && pendingWriteStatus === null;
                }
                setSyncing(false);

                if (!isSafe) {
                    const finalState = useAppStore.getState();
                    let reason: 'conflict' | 'offline' | 'rejected' | 'failed' = 'offline';

                    if (finalState.userData?.pendingConflicts) {
                        reason = 'conflict';
                    } else if (finalState.syncHealth === 'rejected' || pendingWriteStatus === 'rejected') {
                        reason = 'rejected';
                    } else if (finalState.syncHealth === 'failed' || pendingWriteStatus === 'failed') {
                        reason = 'failed';
                    }

                    const action = await useDialogStore.getState().showUnsyncedDataLogout(reason);

                    if (auth.currentUser?.uid !== initialUid) {
                        return;
                    }

                    if (action === 'export') {
                        const { Exporter } = await import('../lib/export');
                        const currentState = useAppStore.getState().userData;
                        if (currentState) {
                            Exporter.exportEmergencyJSON(currentState);
                        }
                        return;
                    }

                    if (action === 'cancel' || action === 'wait') {
                        return;
                    } else if (action === 'safe-exit') {
                        const finalCheck = useAppStore.getState();
                        if (finalCheck.syncHealth !== 'synced' || finalCheck.localWorkout || finalCheck.userData?.pendingConflicts) {
                            return;
                        }
                    } else if (action === 'force-exit') {
                        discardUnsynced = true;
                    } else {
                        return;
                    }
                }
            }

            // A draft can fail while a confirmation dialog or cloud check is open.
            if (useAppStore.getState().localPersistenceBlocked) {
                await useDialogStore.getState().showAlert('Logout sospeso: una modifica locale non è stata salvata sul dispositivo.');
                return;
            }
            setSyncing(true);
            try {
                useAppStore.getState().cancelPendingSyncs();
                await DB.secureLogOut({ discardUnsynced,
                    expectedUid: initialUid ?? undefined,
                    verifyCurrentDrafts: discardUnsynced ? undefined : async () => { await prepareForReload(); },
                });
                DB.resetCache();
                useAppStore.getState().resetStore({ force: true });
                if (initialUid) {
                    clearAuthenticatedOwnerHint(userOwner(initialUid));
                    clearGuestMigrationSyncRecovery(initialUid);
                }
                setGuestMigrationStatus('idle');
            } catch (error: any) {
                console.error("Errore durante il logout:", error);
                const localStorageFailure = error instanceof AggregateError
                    || error instanceof BrowserStorageError
                    || error?.name === 'BrowserStorageError';
                await useDialogStore.getState().showAlert(error instanceof Error && (error.name === 'HealthConsentTransitionPendingError' || error.name === 'UnsyncedLogoutError')
                    ? error.message
                    : localStorageFailure
                        ? 'Impossibile completare il logout perché la memoria locale del dispositivo non è disponibile o non è stata pulita completamente. I dati locali potrebbero essere ancora presenti. Riprova.'
                        : 'Errore durante il logout. Controlla la connessione e riprova.');
            } finally {
                setSyncing(false);
            }
        } finally {
            logoutInFlightRef.current = false;
        }
    }, [isGuestActiveStrict, setSyncing]);

    const value = useMemo(() => ({
        currentUser,
        loading,
        isGuest,
        guestMigrationStatus,
        emailVerificationRequired,
        login,
        loginAsGuest,
        linkGoogleAccount,
        retryGuestMigration,
        logout,
        loginWithEmail,
        registerWithEmail,
        resendEmailVerification,
        refreshEmailVerification,
        continueUnverifiedLocally
    }), [currentUser, loading, isGuest, guestMigrationStatus, emailVerificationRequired, login, loginAsGuest, linkGoogleAccount, retryGuestMigration, logout, loginWithEmail, registerWithEmail, resendEmailVerification, refreshEmailVerification, continueUnverifiedLocally]);

    return (
        <AuthContext.Provider value={value}>
            {children}
        </AuthContext.Provider>
    );
};