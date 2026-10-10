import { useState, useEffect, useRef, useCallback, useMemo, ReactNode } from 'react';
import { User } from 'firebase/auth';
import { auth, getDb, waitForPendingWrites, provider, signInWithPopup, signInWithRedirect, getRedirectResult, onAuthStateChanged, signOut, signInWithEmailAndPassword, createUserWithEmailAndPassword, sendEmailVerification, reload } from '../lib/firebase';
import { DB } from '../lib/db';
import { isAccountDeletionPending } from '../lib/sync/accountGate';
import { useAppStore } from '../store/useAppStore';
import { UserData } from '../types';
import { UserDataSchema } from '../lib/schema';
import { AuthContext, type GuestMigrationPolicy } from './AuthContextDef';
import { useDialogStore } from '../store/useDialogStore';
import { getCachedCatalog, getInMemoryCatalog, isCatalogInMemory } from '../lib/catalog/catalogService';
import { resolveEffectiveExercises, resolveEffectiveFoods } from '../lib/catalog/deltaResolver';
import { draftRegistry } from '../lib/utils/draftRegistry';
import { getResolvedDefaultUserData } from './auth/defaultUserData';
import { loadAuthenticatedData } from './auth/loadAuthenticatedData';
import { migrateGuestAccount } from './auth/migrateGuestAccount';
import { replicateJournal } from '../lib/sync/replicateJournal';
import { activateGuestSession, captureSession, GUEST_REVOCATION_KEY, GUEST_SESSION_KEY, invalidateSession, isActiveGuestSession, isCurrentSession, revokeGuestSession, userOwner } from '../lib/sync/session';
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
import { classifyGooglePopupFailure } from './auth/googlePopup';
import { watchDeletionRecoveryDeviceRegistration } from '../lib/deletionDeviceRecovery';
import { validatePasswordAgainstPolicy } from '../lib/auth/passwordPolicy';
import { describeEmailAuthError } from '../lib/auth/emailAuthError';
import { reportError } from '../lib/errorHandler';
import { clearAuthenticatedOwnerHint, rememberAuthenticatedOwner } from '../lib/sync/authOwnerHint';
import { beginGuestMigrationIntent, bindGuestMigrationIntentToUser, clearGuestMigrationIntent } from '../lib/auth/guestMigrationIntent';

const GUEST_KEY = 'logbook_is_guest';
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

    const startGoogleRedirect = useCallback(async () => {
        redirectLaunchFailedRef.current = false;
        try {
            writeBrowserValue(AWAITING_REDIRECT_KEY, 'true');
            await signInWithRedirect(auth, provider);
        } catch (error) {
            redirectLaunchFailedRef.current = true;
            if (!tryRemoveBrowserValue(AWAITING_REDIRECT_KEY)) {
                try {
                    writeBrowserValue(AWAITING_REDIRECT_KEY, 'failed');
                } catch {
                    console.error('Impossibile rendere non attivo lo stato locale dopo un redirect Google non avviato.');
                }
            }
            throw error;
        }
    }, []);

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
        return watchDeletionRecoveryDeviceRegistration(
            currentUser,
            error => {
                reportError(error, { source: 'account_deletion_device_registration' });
                console.warn('Recovery device non registrato; nuovo tentativo al prossimo ritorno online/in primo piano.', error);
            },
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
        }).catch(err => {
            tryRemoveBrowserValue(AWAITING_REDIRECT_KEY);
            console.error("Ripresa redirect Google fallita:", err);
            setSaveError("Accesso Google non completato. Riprova.");
        });

        const resumePersistedGuestMigration = async (user: User, isCurrentRun: () => boolean): Promise<boolean> => {
            if (!isCurrentRun()) return true;
            setGuestMigrationStatus('pending');

            let authenticatedEnvelope: Awaited<ReturnType<typeof import('../lib/sync/localRepository')['readLocal']>>;
            try {
                const { readLocal } = await import('../lib/sync/localRepository');
                if (!isCurrentRun()) return true;
                authenticatedEnvelope = await readLocal(user.uid);
            } catch (error) {
                if (!isCurrentRun()) return true;
                console.error('Recovery migrazione account non riuscita durante la lettura locale:', error);
                setGuestMigrationStatus('failed');
                setSaveError('Recovery account non completata. I dati locali sono stati lasciati intatti. Riprova.');
                return true;
            }

            if (!isCurrentRun()) return true;

            const guestStillActive = isGuestActiveStrict();
            if (!authenticatedEnvelope) {
                if (guestStillActive) {
                    clearGuestMigrationSyncRecovery(user.uid);
                    return false;
                }

                setGuestMigrationStatus('failed');
                setSaveError('Recovery account non completata: copia locale autenticata non disponibile. I dati non sono stati dichiarati sincronizzati.');
                return true;
            }

            setUserData(authenticatedEnvelope.data);

            if (guestStillActive) {
                useAppStore.getState().setLocalWorkout(authenticatedEnvelope.data.activeWorkout || null);
                try {
                    if (!isCurrentRun()) return true;
                    removeBrowserValue(GUEST_KEY);
                    try { clearGuestMigrationIntent(); } catch { /* recovery may predate the intent protocol */ }
                    isGuestRef.current = false;
                    setIsGuest(false);
                    migrationDataRef.current = null;
                } catch (error) {
                    if (!isCurrentRun()) return true;
                    console.error('Recovery migrazione account non riuscita durante il cambio owner:', error);
                    setGuestMigrationStatus('failed');
                    setSaveError('Recovery account non completata. La copia locale autenticata è conservata; riprova.');
                    return true;
                }
            }

            if (!isCurrentRun()) return true;
            setSyncing(true);
            try {
                const result = await replicateJournal(userOwner(user.uid));
                if (!isCurrentRun()) return true;

                if (result.status === 'synced' || result.status === 'local-pending') {
                    clearGuestMigrationSyncRecovery(user.uid);
                    setGuestMigrationStatus('idle');
                    if (result.status === 'local-pending') {
                        setSaveError('📶 Offline: i dati sono salvati sul dispositivo e verranno sincronizzati quando torni online.');
                    }
                } else {
                    setGuestMigrationStatus('failed');
                    setSaveError('Sincronizzazione account non completata. I dati locali restano conservati. Riprova.');
                }
            } catch (error) {
                if (!isCurrentRun()) return true;
                console.error('Recovery sincronizzazione account non riuscita:', error);
                setGuestMigrationStatus('failed');
                setSaveError('Sincronizzazione account non completata. I dati locali restano conservati. Riprova.');
            } finally {
                if (isCurrentRun()) setSyncing(false);
            }

            return true;
        };

        const unsubscribe = onAuthStateChanged(auth, async (user: any) => {
            if (!isMounted) return;

            try {
            const nextUid = user?.uid ?? null;
            const previousUid = authUidRef.current;
            authUidRef.current = nextUid;
            const authRun = ++authRunRef.current;
            if (previousUid !== nextUid) invalidateSession();
            setSyncing(false);
            if (previousUid !== nextUid) setLoading(true);
            const expectedUid = nextUid;
            const isCurrentRun = () => isMounted
                && authRunRef.current === authRun
                && (expectedUid ? auth.currentUser?.uid === expectedUid : auth.currentUser === null);

            if (user && user.emailVerified === false) {
                // Account creation signs users in before they verify their inbox.
                // Do not claim an owner, hydrate cloud data or transfer guest data
                // until verification is complete; preserve the guest migration intent.
                const current = useAppStore.getState();
                if (!isGuestActiveStrict() && current.dataOwner && current.dataOwner !== userOwner(user.uid)) {
                    // Discard only the stale in-memory owner; retain both IndexedDB archives.
                    useAppStore.setState({ userData: null, dataOwner: null, localWorkout: null });
                }
                setGuestMigrationStatus('idle');
                setCurrentUser(user);
                setEmailVerificationRequired(true);
                setLoading(false);
                return;
            }
            if (user) {
                tryRemoveBrowserValue(AWAITING_REDIRECT_KEY);
                const expectedOwner = userOwner(user.uid);
                const current = useAppStore.getState();
                const guestActiveBeforeAuth = isGuestActiveStrict();
                if (current.userData && current.dataOwner && current.dataOwner !== expectedOwner && !guestActiveBeforeAuth) {
                    useAppStore.setState({ userData: null, dataOwner: null, localWorkout: null });
                }
                try {
                    rememberAuthenticatedOwner(user.uid);
                } catch (error) {
                    console.error('Owner autenticato locale non persistibile:', error);
                    useAppStore.setState({
                        userData: null,
                        dataOwner: null,
                        localWorkout: null,
                        localPersistenceBlocked: true,
                        syncHealth: 'failed',
                        saveError: 'Archivio del dispositivo non disponibile. Riprova prima di continuare.',
                    });
                    setCurrentUser(user);
                    setLoading(false);
                    return;
                }
            }
            setCurrentUser(user);

            if (user) {
                const wasGuest = isGuestActiveStrict();
                setEmailVerificationRequired(false);
                const recoveryUid = readGuestMigrationRecoveryStrict();

                if (recoveryUid === user.uid) {
                    setLoading(false);
                    const handled = await resumePersistedGuestMigration(user, isCurrentRun);
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
                                setSaveError('📶 Offline: account preparato sul dispositivo. La sincronizzazione riprenderà quando torni online.');
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
                setEmailVerificationRequired(false);
                setGuestMigrationStatus('idle');
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

        let isReloading = false;
        const handleVisibilityChange = async () => {
            if (isGuestActiveStrict()) return;
            if (document.visibilityState === 'visible' && auth.currentUser &&
                auth.currentUser.emailVerified !== false) {
                if (useAppStore.getState().userData !== null && !useAppStore.getState().syncing && !isReloading) {
                    try {
                        isReloading = true;
                        await Promise.race([
                            waitForPendingWrites(getDb()),
                            new Promise(resolve => setTimeout(resolve, 1500))
                        ]);
                        await loadData(auth.currentUser);
                    } catch (e) {
                        console.warn("Skipping visibility reload due to pending writes / timeout", e);
                    } finally {
                        isReloading = false;
                    }
                }
            }
        };
        document.addEventListener('visibilitychange', handleVisibilityChange);
        window.addEventListener('online', handleVisibilityChange);

        return () => {
            isMounted = false;
            authRunRef.current += 1;
            invalidateSession();
            unsubscribe();
            document.removeEventListener('visibilitychange', handleAuthVisibilityChange);
            document.removeEventListener('visibilitychange', handleVisibilityChange);
            window.removeEventListener('online', handleVisibilityChange);
        };
    }, [isGuestActiveStrict, loadData, readGuestMigrationRecoveryStrict, setSyncing, setUserData, setSaveError]);

    // Login con Google (dalla schermata di login, nessun guest precedente)
    const login = useCallback(async (guestPolicy?: GuestMigrationPolicy) => {
        setSaveError(null);
        if (isGuestActiveStrict()) {
            if (!guestPolicy) throw new Error('Scelta di trasferimento guest richiesta.');
            beginGuestMigrationIntent(guestPolicy, 'google');
        }
        try {
            await signInWithPopup(auth, provider);
        } catch (error: any) {
            const failure = classifyGooglePopupFailure(error);
            if (failure === 'redirect') {
                try {
                    await startGoogleRedirect();
                } catch (redirectError) {
                    console.error("Errore login redirect", redirectError);
                    setSaveError("Accesso fallito. Riprova.");
                }
            } else if (failure === 'cancelled') {
                try { clearGuestMigrationIntent(); } catch { /* best effort: no successful auth occurred */ }
            } else if (failure === 'network') {
                try { clearGuestMigrationIntent(); } catch { /* best effort: no successful auth occurred */ }
                setSaveError("Connessione non disponibile. Riprova quando sei online.");
            } else if (failure === 'error') {
                try { clearGuestMigrationIntent(); } catch { /* best effort */ }
                console.error("Errore di login", error);
                setSaveError("Errore di accesso: " + error.message);
            }
        }
    }, [isGuestActiveStrict, setSaveError, startGoogleRedirect]);

    const handleAuthError = useCallback((error: unknown): never => {
        setSaveError(describeEmailAuthError(error));
        throw error;
    }, [setSaveError]);

    const loginWithEmail = useCallback(async (email: string, pass: string, guestPolicy?: GuestMigrationPolicy) => {
        setSaveError(null);
        if (isGuestActiveStrict()) {
            if (!guestPolicy) throw new Error('Scelta di trasferimento guest richiesta.');
            beginGuestMigrationIntent(guestPolicy, 'email', { email });
        }
        try {
            await signInWithEmailAndPassword(auth, email, pass);
        } catch (error) {
            try { clearGuestMigrationIntent(); } catch { /* best effort */ }
            handleAuthError(error);
        }
    }, [handleAuthError, isGuestActiveStrict, setSaveError]);

    const registerWithEmail = useCallback(async (email: string, pass: string, guestPolicy?: GuestMigrationPolicy) => {
        setSaveError(null);
        const weakError = await validatePasswordAgainstPolicy(pass);
        if (weakError) {
            const error = Object.assign(new Error(weakError), { code: 'auth/weak-password' });
            handleAuthError(error);
            return;
        }

        migrationDataRef.current = useAppStore.getState().userData;
        if (isGuestActiveStrict()) {
            if (!guestPolicy) throw new Error('Scelta di trasferimento guest richiesta.');
            beginGuestMigrationIntent(guestPolicy, 'email', { email });
        }

        let credential: Awaited<ReturnType<typeof createUserWithEmailAndPassword>>;
        try {
            credential = await createUserWithEmailAndPassword(auth, email, pass);
        } catch (error) {
            try { clearGuestMigrationIntent(); } catch { /* best effort */ }
            handleAuthError(error);
            return;
        }

        if (!credential.user.emailVerified) {
            try {
                await sendEmailVerification(credential.user);
                setSaveError('Verifica la tua email per completare l’accesso. Ti abbiamo inviato un link di conferma.');
            } catch (error) {
                console.error('Invio verifica email fallito:', error);
                setSaveError('Account creato, ma non è stato possibile inviare la verifica email. Usa “Invia di nuovo” e riprova.');
            }
        }
    }, [handleAuthError, isGuestActiveStrict, setSaveError]);

    const resendEmailVerification = useCallback(async () => {
        const user = auth.currentUser;
        if (!user || user.emailVerified) return;
        await sendEmailVerification(user);
        setSaveError('Email di verifica inviata. Controlla anche la cartella spam.');
    }, [setSaveError]);

    const refreshEmailVerification = useCallback(async () => {
        const user = auth.currentUser;
        if (!user) throw new Error('Sessione non disponibile.');
        await reload(user);
        if (!user.emailVerified) {
            setEmailVerificationRequired(true);
            setSaveError('Email non ancora verificata. Apri il link ricevuto e riprova.');
            return;
        }
        // Firebase's ID token may still contain email_verified=false after reload().
        // Refresh its claims before resuming any owner-scoped cloud operation.
        await user.getIdToken(true);
        await safeHardReload();
    }, [setSaveError]);

    // Accesso guest: solo localStorage, zero Firebase
    const loginAsGuest = useCallback(async () => {
        try {
            // Serialize the entire cleanup-to-activation transition across tabs.
            // An older logout must never delete a new guest generation.
            await withGuestLifecycleLock(async () => {
                clearAuthenticatedOwnerHint();
                if (readBrowserValueStrict(GUEST_REVOCATION_KEY) !== null) {
                    await DB.purgeAllLocalUserData('guest');
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
            });
        } catch {
            setSaveError('Impossibile avviare la modalità locale: pulizia o coordinamento delle sessioni non disponibile. I dati esistenti restano protetti.');
            return;
        }
        isGuestRef.current = true;
        setIsGuest(true);
        setGuestMigrationStatus('idle');
        const currentData = useAppStore.getState().userData;
        if (!currentData) {
            const catalog = isCatalogInMemory() ? getInMemoryCatalog() : (await getCachedCatalog());
            const initialGuestData = getResolvedDefaultUserData(catalog);
            setUserData(UserDataSchema.parse(initialGuestData) as unknown as UserData);
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
                setUserData({
                    ...currentData,
                    library: resolvedLibrary,
                    customFoods: resolvedFoods
                });
            }
        }
    }, [setSaveError, setUserData]);

    const continueUnverifiedLocally = useCallback(async () => {
        const user = auth.currentUser;
        if (!user || user.emailVerified !== false) {
            throw new Error('Nessuna verifica email in attesa.');
        }
        // Sign out without the authenticated purge path: local owner envelopes and
        // any guest migration intent must survive until an explicit verified login.
        await signOut(auth);
        if (!isGuestActiveStrict()) {
            // Never seed a fresh guest from another authenticated user's in-memory data.
            // resetStore does not delete the authenticated IndexedDB envelope.
            useAppStore.getState().resetStore({ force: true });
            await loginAsGuest();
        }
    }, [isGuestActiveStrict, loginAsGuest]);

    // Collega account Google: migra i dati locali su Firestore
    const linkGoogleAccount = useCallback(async (guestPolicy?: GuestMigrationPolicy) => {
        setSaveError(null);
        migrationDataRef.current = useAppStore.getState().userData;
        if (isGuestActiveStrict()) {
            if (!guestPolicy) throw new Error('Scelta di trasferimento guest richiesta.');
            beginGuestMigrationIntent(guestPolicy, 'google');
        }
        try {
            await signInWithPopup(auth, provider);
        } catch (error: any) {
            const failure = classifyGooglePopupFailure(error);
            if (failure === 'redirect') {
                try {
                    await startGoogleRedirect();
                } catch (redirectError) {
                    console.error("Errore collegamento redirect:", redirectError);
                    setSaveError("Accesso fallito. Riprova.");
                }
                return;
            }
            if (failure === 'cancelled') {
                try { clearGuestMigrationIntent(); } catch { /* best effort */ }
                return;
            }
            if (failure === 'network') {
                try { clearGuestMigrationIntent(); } catch { /* best effort */ }
                setSaveError("Connessione non disponibile. Riprova quando sei online.");
                return;
            }
            if (failure === 'error') {
                try { clearGuestMigrationIntent(); } catch { /* best effort */ }
                console.error("Errore collegamento account Google:", error);
                setSaveError("Collegamento fallito. Riprova.");
            }
        }
    }, [isGuestActiveStrict, setSaveError, startGoogleRedirect]);

    const retryGuestMigration = useCallback(async (policy?: GuestMigrationPolicy) => {
        setSaveError(null);

        if (isGuestActiveStrict()) {
            try {
                const uid = auth.currentUser?.uid;
                if (!uid || !policy) throw new Error('Scegli esplicitamente se trasferire o non trasferire i dati locali.');
                beginGuestMigrationIntent(policy, 'recovery', { uid });
                await safeHardReload();
            } catch (error) {
                setGuestMigrationStatus('failed');
                setSaveError(
                    error instanceof Error && error.message.includes('Scelta di trasferimento')
                        ? 'Scegli esplicitamente se trasferire o non trasferire i dati locali.'
                        : error instanceof Error ? error.message : 'Ricaricamento non sicuro. Riprova.'
                );
            }
            return;
        }

        const initialUid = auth.currentUser?.uid;
        if (!initialUid) {
            setGuestMigrationStatus('failed');
            setSaveError('Sincronizzazione account non completata. Accedi nuovamente e riprova.');
            return;
        }

        const session = captureSession();
        const expectedOwner = userOwner(initialUid);
        const isCurrentRetry = () => session.owner === expectedOwner
            && isCurrentSession(session)
            && auth.currentUser?.uid === initialUid
            && !isGuestActiveStrict();

        if (!isCurrentRetry()) return;

        setGuestMigrationStatus('pending');
        setSyncing(true);
        try {
            const result = await replicateJournal(expectedOwner);
            if (!isCurrentRetry()) return;

            if (result.status === 'synced' || result.status === 'local-pending') {
                clearGuestMigrationSyncRecovery(initialUid);
                setGuestMigrationStatus('idle');
                if (result.status === 'local-pending') {
                    setSaveError('📶 Offline: i dati sono salvati sul dispositivo e verranno sincronizzati quando torni online.');
                }
            } else {
                setGuestMigrationStatus('failed');
                setSaveError('Sincronizzazione account non completata. I dati locali restano conservati. Riprova.');
            }
        } catch (error) {
            if (!isCurrentRetry()) return;
            console.error('Retry sincronizzazione account non riuscito:', error);
            setGuestMigrationStatus('failed');
            setSaveError('Sincronizzazione account non completata. I dati locali restano conservati. Riprova.');
        } finally {
            if (isCurrentRetry()) setSyncing(false);
        }
    }, [isGuestActiveStrict, setSaveError, setSyncing]);

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

            if (mode === 'normal') {
                setSyncing(true);
                const state = useAppStore.getState();
                let isSafe = state.syncHealth === 'synced' && !state.userData?.pendingConflicts;
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
                    isSafe = finalState.syncHealth === 'synced' && !finalState.userData?.pendingConflicts && pendingWriteStatus === null;
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
                        if (finalCheck.syncHealth !== 'synced' || finalCheck.userData?.pendingConflicts) {
                            return;
                        }
                    }
                }
            }

            setSyncing(true);
            try {
                useAppStore.getState().cancelPendingSyncs();
                await DB.secureLogOut();
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
                await useDialogStore.getState().showAlert(localStorageFailure
                    ? 'Impossibile completare il logout perché la memoria locale del dispositivo non è disponibile o non è stata pulita completamente. I dati locali potrebbero essere ancora presenti. Riprova.'
                    : 'Errore durante il logout. Controlla la connessione e riprova.');
            } finally {
                setSyncing(false);
            }
        } finally {
            logoutInFlightRef.current = false;
        }
    }, [setSyncing]);

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