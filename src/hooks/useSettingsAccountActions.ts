import { useRef, useState } from 'react';
import type { useAuth } from './useAuth';
import { useSettingsHealthDataDeletion, type SettingsDeletionInFlight } from './useSettingsHealthDataDeletion';
import { useAppStore } from '../store/useAppStore';
import { useDialogStore } from '../store/useDialogStore';
import { DB } from '../lib/db';
import { captureSession, isCurrentSession, isActiveGuestSession } from '../lib/sync/session';
import { readLocal } from '../lib/sync/localRepository';
import { auth } from '../lib/firebase';
import { isAccountDeletionPending } from '../lib/sync/accountGate';
import { isSensitiveReauthCancellation, reauthenticateForSensitiveAction } from '../lib/auth/recentAuth';
import { reportError } from '../lib/errorHandler';
import { revokeSessionsOnServer } from '../lib/auth/revokeSessions';

type AccountActionsAuth = Pick<ReturnType<typeof useAuth>, 'currentUser' | 'isGuest' | 'logout'>;

export function useSettingsAccountActions({ currentUser, isGuest, logout }: AccountActionsAuth) {
    const showAlert = useDialogStore(state => state.showAlert);
    const showConfirm = useDialogStore(state => state.showConfirm);
    const showPasswordPrompt = useDialogStore(state => state.showPasswordPrompt);

    const handleLogout = async () => {
        const session = captureSession();
        if (isGuest) {
            if (isCurrentSession(session)) await logout({ mode: 'normal' });
        } else if (await showConfirm("Sei sicuro di voler uscire dal tuo account?")) {
            // A confirmation from A must never sign out B after an auth change.
            if (isCurrentSession(session)) await logout({ mode: 'normal' });
        }
    };

    const [revokingSessions, setRevokingSessions] = useState(false);
    const revokingSessionsBusy = useRef(false);

    const handleLogoutEverywhere = async () => {
        if (revokingSessionsBusy.current || !currentUser) return;
        revokingSessionsBusy.current = true;
        const expectedUid = currentUser.uid;
        const session = captureSession();
        try {
            const assertCurrent = () => {
                if (!isCurrentSession(session) || auth.currentUser?.uid !== expectedUid) {
                    throw new Error('Sessione cambiata: operazione annullata.');
                }
            };
            const assertSafeLocalState = async () => {
                assertCurrent();
                const state = useAppStore.getState();
                if (state.localPersistenceBlocked || state.localWorkout || state.userData?.pendingConflicts || state.cloudIntegrityBlocked) {
                    throw new Error('Completa l’allenamento e risolvi i salvataggi locali prima di disconnettere tutti i dispositivi.');
                }
                if (session.owner === 'user:' + expectedUid) {
                    const local = await readLocal(session.owner);
                    assertCurrent();
                    // Hydration may lag behind a durable integrity fence installed by another task/tab.
                    const latest = useAppStore.getState();
                    if (local?.cloudIntegrityFence || latest.cloudIntegrityBlocked) {
                        throw new Error('Snapshot cloud non verificato: completa il recupero dei dati prima di revocare le sessioni.');
                    }
                    if (latest.localPersistenceBlocked || latest.localWorkout || latest.userData?.pendingConflicts) {
                        throw new Error('Completa l’allenamento e risolvi i salvataggi locali prima di disconnettere tutti i dispositivi.');
                    }
                    if ((local?.pending.length ?? 0) !== 0 || (latest.userData !== null && latest.syncHealth !== 'synced')) {
                        throw new Error('Ci sono dati non ancora sincronizzati. Sincronizzali oppure esporta un backup prima di proseguire.');
                    }
                }
            };

            await assertSafeLocalState();
            if (typeof navigator !== 'undefined' && navigator.onLine === false) {
                throw new Error('Connettiti a Internet per disconnettere tutti i dispositivi.');
            }
            if (isAccountDeletionPending('user:' + expectedUid)) {
                throw new Error('Completa prima la cancellazione account in sospeso.');
            }
            if (!(await showConfirm(
                'Disconnettere tutte le sessioni del tuo account, incluso questo dispositivo? Dovrai accedere di nuovo. I dispositivi offline potrebbero ancora avere copie locali: questa funzione non le cancella. Continua?'
            ))) return;
            await assertSafeLocalState();
            setRevokingSessions(true);

            let reauth = await reauthenticateForSensitiveAction(auth.currentUser!);
            assertCurrent();
            if (reauth === 'password-required') {
                const password = await showPasswordPrompt('Per disconnettere tutti i dispositivi, inserisci la password attuale.', 'Verifica identità');
                if (password === null) return;
                assertCurrent();
                reauth = await reauthenticateForSensitiveAction(auth.currentUser!, password);
            }
            assertCurrent();
            if (reauth === 'redirect-started') {
                await showAlert('Verifica Google avviata. Completa l’accesso e ripeti l’operazione.');
                return;
            }
            if (reauth !== 'reauthenticated') {
                throw new Error('Non è stato possibile verificare nuovamente l’identità.');
            }

            await assertSafeLocalState();
            await revokeSessionsOnServer(auth.currentUser!);
            // A new login to the same UID must not inherit the old request's local logout.
            if (!isCurrentSession(session) || auth.currentUser?.uid !== expectedUid) return;
            // The server barrier now rejects the previous sessions at the
            // Firestore boundary. Use the ordinary guarded logout so no local
            // pending journal or vault metadata is discarded inappropriately.
            if (auth.currentUser?.uid === expectedUid) {
                await logout({ mode: 'normal' });
            }
            if (isCurrentSession(session) && auth.currentUser?.uid === expectedUid) {
                await showAlert('Accesso cloud dagli altri dispositivi revocato. Il logout locale non è completo: verifica i dati non sincronizzati e ripeti “Esci dall’account”.');
            }
        } catch (error) {
            // Errors from a superseded request must not open an account A dialog over B.
            if (auth.currentUser?.uid !== expectedUid || !isCurrentSession(session)) return;
            if (isSensitiveReauthCancellation(error)) return;
            const code = (error as { code?: unknown } | null)?.code;
            if (code === 'auth/wrong-password' || code === 'auth/invalid-credential') {
                await showAlert('Password attuale non corretta.');
            } else {
                await showAlert(error instanceof Error ? error.message : 'Revoca non confermata. Riprova dopo aver verificato la connessione.');
            }
        } finally {
            revokingSessionsBusy.current = false;
            setRevokingSessions(false);
        }
    };

    const [deletingAccount, setDeletingAccount] = useState(false);
    const [deletionPhase, setDeletionPhase] = useState<'idle' | 'verifying' | 'deleting'>('idle');
    // Both destructive flows must acquire this guard before their first await.
    const deletionBusy = useRef<SettingsDeletionInFlight>(null);
    const beginHealthDeletion = () => {
        if (deletionBusy.current !== null) return false;
        deletionBusy.current = 'health-data';
        return true;
    };
    const endHealthDeletion = () => {
        if (deletionBusy.current === 'health-data') deletionBusy.current = null;
    };
    const { erasingHealthData, handleDeleteHealthData } = useSettingsHealthDataDeletion(beginHealthDeletion, endHealthDeletion);
    let pendingAccountDeletion = false;
    try { pendingAccountDeletion = isAccountDeletionPending(captureSession().owner); }
    catch { /* The writer separately refuses an unreadable deletion marker. */ }


    const handleDeleteAccount = async () => {
        if (deletionBusy.current !== null) return;
        deletionBusy.current = 'account';
        let session: ReturnType<typeof captureSession> | null = null;
        const expectedUid = currentUser?.uid ?? null;
        try {
            session = captureSession();
            const assertCurrent = () => {
                if (!session || !isCurrentSession(session)
                    || (expectedUid !== null && auth.currentUser?.uid !== expectedUid)) {
                    throw new Error('Sessione cambiata: cancellazione annullata.');
                }
            };
            if (isGuest && !currentUser) {
                if (!(await showConfirm('Eliminare permanentemente i dati ospite di questo dispositivo?'))) return;
                assertCurrent();
                await logout({ mode: 'force' });
                return;
            }
            if (!(await showConfirm('Questa operazione è irreversibile: elimina allenamenti, nutrizione, misurazioni e account. Prima di continuare, chiudi TheLogBook sugli altri dispositivi ed esporta un backup se vuoi conservare i dati. Procedere?'))) return;
            assertCurrent();
            if (!(await showConfirm('Ultima conferma: eliminare definitivamente il tuo account TheLogBook?'))) return;
            assertCurrent();
            setDeletingAccount(true);
            setDeletionPhase('verifying');
            assertCurrent();
            const user = auth.currentUser;
            if (!user || (session.owner !== 'user:' + user.uid
                && !(session.owner === 'guest' && isActiveGuestSession()))) {
                throw new Error('Account cambiato.');
            }

            let reauth = await reauthenticateForSensitiveAction(user);
            if (reauth === 'password-required') {
                const password = await showPasswordPrompt(
                    'Per eliminare definitivamente l’account, inserisci la password attuale.',
                    'Verifica identità',
                );
                if (password === null) return;
                assertCurrent();
                reauth = await reauthenticateForSensitiveAction(user, password);
            }
            assertCurrent();
            if (reauth === 'redirect-started') {
                await showAlert('Verifica Google avviata. Completa il passaggio con Google e poi ripeti la cancellazione account.');
                return;
            }
            if (reauth !== 'reauthenticated') {
                throw new Error('Nessun metodo di autenticazione disponibile per confermare la cancellazione.');
            }

            setDeletionPhase('deleting');
            const outcome = await DB.deleteAccount({
                cancelPendingSyncs: () => useAppStore.getState().cancelPendingSyncs(),
                resetStore: () => useAppStore.getState().resetStore(),
            });
            if (outcome.status === 'pending') await showAlert(outcome.message);
        } catch (error) {
            if (isSensitiveReauthCancellation(error)) return;
            const code = (error as { code?: unknown } | null)?.code;
            const isCredentialMistake = code === 'auth/wrong-password' || code === 'auth/invalid-credential';
            if (!isCredentialMistake) {
                reportError(error, { source: 'account_deletion' });
            }
            const message = isCredentialMistake
                ? 'Password attuale non corretta.'
                : error instanceof Error ? error.message : 'Cancellazione non riuscita.';
            let canShow = session === null;
            if (session) {
                try { canShow = captureSession().owner === session.owner; }
                catch { canShow = true; }
            }
            if (canShow) void showAlert(message);
        } finally {
            deletionBusy.current = null;
            setDeletingAccount(false);
            setDeletionPhase('idle');
        }
    };
    return {
        handleLogout, handleLogoutEverywhere, revokingSessions,
        deletingAccount, deletionPhase, pendingAccountDeletion,
        erasingHealthData, handleDeleteHealthData, handleDeleteAccount,
    };
}
