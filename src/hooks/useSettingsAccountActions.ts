import { useRef, useState } from 'react';
import type { useAuth } from './useAuth';
import { useAppStore } from '../store/useAppStore';
import { useDialogStore } from '../store/useDialogStore';
import { DB } from '../lib/db';
import { captureSession, isCurrentSession, isActiveGuestSession } from '../lib/sync/session';
import { readLocal } from '../lib/sync/localRepository';
import { currentHealthConsentStatus } from '../lib/healthConsent';
import { auth, signOut } from '../lib/firebase';
import { purgeCompletedHealthDataLocal } from '../lib/db/db_account';
import { requestHealthDataErasure } from '../lib/healthDataErasure';
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
        try {
            const session = captureSession();
            const assertCurrent = () => {
                if (!isCurrentSession(session) || auth.currentUser?.uid !== expectedUid) {
                    throw new Error('Sessione cambiata: operazione annullata.');
                }
            };
            const assertSafeLocalState = async () => {
                assertCurrent();
                const state = useAppStore.getState();
                if (state.localPersistenceBlocked || state.localWorkout || state.userData?.pendingConflicts) {
                    throw new Error('Completa l’allenamento e risolvi i salvataggi locali prima di disconnettere tutti i dispositivi.');
                }
                if (session.owner === 'user:' + expectedUid) {
                    const local = await readLocal(session.owner);
                    assertCurrent();
                    if ((local?.pending.length ?? 0) !== 0 || (state.userData !== null && state.syncHealth !== 'synced')) {
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
            // The server barrier now rejects the previous sessions at the
            // Firestore boundary. Use the ordinary guarded logout so no local
            // pending journal or vault metadata is discarded inappropriately.
            if (auth.currentUser?.uid === expectedUid) {
                await logout({ mode: 'normal' });
            }
            if (auth.currentUser?.uid === expectedUid) {
                await showAlert('Accesso cloud dagli altri dispositivi revocato. Il logout locale non è completo: verifica i dati non sincronizzati e ripeti “Esci dall’account”.');
            }
        } catch (error) {
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
    const deleteBusy = useRef(false);
    const erasureBusy = useRef(false);
    const [erasingHealthData, setErasingHealthData] = useState(false);
    let pendingAccountDeletion = false;
    try { pendingAccountDeletion = isAccountDeletionPending(captureSession().owner); }
    catch { /* The writer separately refuses an unreadable deletion marker. */ }

    const handleDeleteHealthData = async () => {
        if (erasureBusy.current || deleteBusy.current) return;
        erasureBusy.current = true;
        let serverComplete = false;
        try {
            const user = auth.currentUser;
            const session = captureSession();
            if (!user || session.owner !== 'user:' + user.uid) {
                throw new Error('Accedi al tuo account prima di richiedere la cancellazione.');
            }
            const assertCurrent = () => {
                if (!isCurrentSession(session) || auth.currentUser?.uid !== user.uid) {
                    throw new Error('Sessione cambiata durante la cancellazione. Verifica il risultato prima di riprovare.');
                }
            };
            if (currentHealthConsentStatus(user.uid) !== 'withdrawn') {
                throw new Error('Prima di eliminare i dati, attendi la conferma della revoca del consenso sul server.');
            }
            if (navigator.onLine === false) {
                throw new Error('Per cancellare i dati cloud devi essere connesso a Internet.');
            }
            if (!(await showConfirm(
                'Verranno rimossi dal database operativo TheLogBook e da questo dispositivo allenamenti, nutrizione, misurazioni, schede, bozze e copie di recupero locali.\\n\\nIl tuo account Firebase (email e accesso) resterà esistente, ma verrai disconnesso. Dispositivi offline, backup JSON già scaricati e possibili copie tecniche del fornitore possono conservare dati soggetti a tempi di conservazione separati.\\n\\nEsporta prima un backup solo se desideri conservare una copia dei dati. Vuoi procedere?'
            ))) return;
            assertCurrent();
            if (!(await showConfirm(
                'ULTIMA CONFERMA: tutti i dati fitness e nutrizione salvati saranno eliminati senza possibilità di recuperarli tramite TheLogBook. L’operazione cloud può impiegare tempo e non potrà essere annullata una volta avviata. Confermi?'
            ))) return;
            assertCurrent();
            let reauth = await reauthenticateForSensitiveAction(user);
            assertCurrent();
            if (reauth === 'password-required') {
                const password = await showPasswordPrompt('Inserisci la password attuale per confermare la cancellazione dei dati.', 'Verifica identità');
                if (password === null) return;
                assertCurrent();
                reauth = await reauthenticateForSensitiveAction(user, password);
            }
            assertCurrent();
            if (reauth === 'redirect-started') {
                await showAlert('La verifica Google è stata avviata. Completa l’accesso e ripeti la cancellazione.');
                return;
            }
            if (reauth !== 'reauthenticated') {
                throw new Error('Non è stato possibile verificare nuovamente la tua identità.');
            }
            setErasingHealthData(true);
            assertCurrent();
            useAppStore.getState().cancelPendingSyncs();
            const result = await requestHealthDataErasure(user);
            assertCurrent();
            if (!result.complete) {
                const message = result.status === 'failed'
                    ? 'La cancellazione cloud è incompleta e potrebbe aver già eliminato parte dei dati. Riprova dopo aver verificato il servizio. Se il problema persiste, richiedi assistenza.'
                    : 'La richiesta è stata accettata, ma la cancellazione cloud è ancora in corso. I dati locali rimangono conservati e bloccati. Riprova più tardi per verificare il completamento.';
                await showAlert(message, 'Cancellazione non ancora completata');
                return;
            }
            serverComplete = true;
            // Auth may still be live, but user data must not be republished.
            // Purge verifies IndexedDB removal before erasing encryption keys.
            await purgeCompletedHealthDataLocal(session.owner);
            // The completed purge removes the consent marker itself; this
            // intentionally invalidates the pre-erasure session snapshot.
            if (auth.currentUser?.uid !== user.uid) {
                throw new Error('Account cambiato dopo la pulizia locale.');
            }
            DB.resetCache();
            useAppStore.getState().resetStore({ force: true });
            await signOut(auth);
            await showAlert('Dati del database operativo e di questo dispositivo eliminati. Il tuo account non è stato cancellato: puoi accedere di nuovo. Copie su dispositivi offline, backup già esportati e backup tecnici del fornitore non sono eliminabili da questo comando.', 'Cancellazione completata');
        } catch (error) {
            if (isSensitiveReauthCancellation(error)) return;
            await showAlert(
                (serverComplete
                    ? 'Il server ha completato la cancellazione, ma la pulizia su questo dispositivo o la disconnessione non è terminata. Non considerare conclusa la pulizia locale. Riprova da questo dispositivo.\\n\\n'
                    : 'La cancellazione potrebbe essere stata avviata: non ripristinare vecchie copie senza aver verificato lo stato.\\n\\n')
                + (error instanceof Error ? error.message : 'Verifica cancellazione non riuscita.'),
                'Cancellazione da verificare',
            );
        } finally {
            erasureBusy.current = false;
            setErasingHealthData(false);
        }
    };

    const handleDeleteAccount = async () => {
        if (deleteBusy.current) return;
        deleteBusy.current = true;
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
            deleteBusy.current = false;
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
