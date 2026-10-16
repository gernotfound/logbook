import { dispatchDurableOperation } from '../lib/sync/dispatchDurableOperation';
import { useEffect, useRef, useState } from 'react';
import { useAuth } from './useAuth';
import { useAppStore } from '../store/useAppStore';
import { useDialogStore } from '../store/useDialogStore';
import { DB } from '../lib/db';
import { captureSession, isCurrentSession, isActiveGuestSession } from '../lib/sync/session';
import { collectBackupSnapshot } from '../lib/db/backupSnapshot';
import { readLocal } from '../lib/sync/localRepository';
import { UserDataSchema } from '../lib/schema';
import { currentHealthConsentStatus } from '../lib/healthConsent';
import { auth, signOut } from '../lib/firebase';
import { purgeCompletedHealthDataLocal } from '../lib/db/db_account';
import { requestHealthDataErasure } from '../lib/healthDataErasure';
import type { ImportMode } from '../lib/backup';
import { isAccountDeletionPending } from '../lib/sync/accountGate';
import {
    isSensitiveReauthCancellation,
    reauthenticateForSensitiveAction,
} from '../lib/auth/recentAuth';
import { reportError } from '../lib/errorHandler';
import { revokeSessionsOnServer } from '../lib/auth/revokeSessions';

export function useSettings() {
    const { currentUser, isGuest, logout } = useAuth();
    const storeProfile = useAppStore(state => state.userData?.profile);
    // Snapshot save is retained here only for the bulk import boundary.
    const saveUserData = useAppStore(state => state.saveUserData);
    const dispatchDomainOperation = useAppStore(state => state.dispatchDomainOperation);
    const showAlert = useDialogStore(state => state.showAlert);
    const showConfirm = useDialogStore(state => state.showConfirm);
    const showPasswordPrompt = useDialogStore(state => state.showPasswordPrompt);

    const [localProfile, setLocalProfile] = useState<any>(null);
    const profile = localProfile ?? storeProfile ?? { dob: '', height: '', gender: '' };

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

    const dob = profile.dob || '';
    const height = profile.height || '';
    const gender = profile.gender || '';

    const setDob = (val: string) => setLocalProfile({ ...profile, dob: val });
    const setHeight = (val: string) => setLocalProfile({ ...profile, height: val });
    const setGender = (val: string) => setLocalProfile({ ...profile, gender: val });
    const [deletingAccount, setDeletingAccount] = useState(false);
    const [deletionPhase, setDeletionPhase] = useState<'idle' | 'verifying' | 'deleting'>('idle');
    const deleteBusy = useRef(false);
    const erasureBusy = useRef(false);
    const [erasingHealthData, setErasingHealthData] = useState(false);
    const [importingData, setImportingData] = useState(false);
    const importBusy = useRef(false);
    const exportBusy = useRef(false);
    const [exportingData, setExportingData] = useState(false);
    const [preparedBackupUrl, setPreparedBackupUrl] = useState<string | null>(null);
    const preparedUrlRef = useRef<string | null>(null);
    useEffect(() => () => {
        if (preparedUrlRef.current) URL.revokeObjectURL(preparedUrlRef.current);
    }, []);
    const releasePreparedBackup = () => {
        if (preparedUrlRef.current) URL.revokeObjectURL(preparedUrlRef.current);
        preparedUrlRef.current = null;
        setPreparedBackupUrl(null);
    };
    let pendingAccountDeletion = false;
    try { pendingAccountDeletion = isAccountDeletionPending(captureSession().owner); }
    catch { /* The writer separately refuses an unreadable deletion marker. */ }

    const handleSaveProfile = async (e?: any) => {
        if (e) e.preventDefault();
        const newProfile = { dob, height, gender };
        try {
            await dispatchDurableOperation(dispatchDomainOperation, { type: 'profile.patch', patch: newProfile });
            setLocalProfile(null);
        } catch {
            await showAlert("Errore durante il salvataggio del profilo.");
        }
    };

    const handleExportCSV = async () => {
        const session = captureSession();
        const state = useAppStore.getState();
        const userData = state.userData;
        if (!userData || state.dataOwner !== session.owner) return;
        try {
            const { Exporter } = await import('../lib/export');
            if (!isCurrentSession(session)) return;
            await Exporter.exportToCSV(userData.history || [], userData.nutrition || {}, userData.library || []);
        } catch (error) {
            console.error('Errore esportazione CSV:', error);
            await showAlert('Esportazione CSV non riuscita. Riprova.');
        }
    };

    const handleExportShare = async (options?: { exportLibrary?: boolean | string[], exportRoutines?: boolean | string[], exportTrainingCycles?: boolean | string[] }) => {
        const session = captureSession();
        const state = useAppStore.getState();
        const userData = state.userData;
        if (!userData || state.dataOwner !== session.owner) return;
        try {
            const { Exporter } = await import('../lib/export');
            if (!isCurrentSession(session)) return;
            const result = await Exporter.exportShareJson(userData, options);
            if (result) {
                await showAlert(`Esportati con successo: ${result.cyclesCount} cicli, ${result.routinesCount} schede, ${result.libraryCount} esercizi.`);
            }
        } catch (error) {
            console.error('Errore esportazione condivisione:', error);
            await showAlert('Esportazione JSON non riuscita. Riprova.');
        }
    };

    const performBackupExport = async (prepareDownload: boolean) => {
        if (exportBusy.current) return;
        const session = captureSession();
        const state = useAppStore.getState();
        if (state.userData !== null && state.dataOwner !== session.owner) {
            await showAlert('Esportazione bloccata: i dati in memoria appartengono a una sessione diversa.');
            return;
        }
        const stateData = state.userData;
        if (!stateData && (session.owner === 'guest' || currentHealthConsentStatus(session.owner.slice(5)) === 'active')) {
            await showAlert('I dati non sono ancora disponibili. Attendi il caricamento prima di esportare.');
            return;
        }
        releasePreparedBackup();
        exportBusy.current = true;
        setExportingData(true);
        try {
            const envelope = stateData ? undefined : await readLocal(session.owner);
            const userData = stateData ?? envelope?.data ?? (UserDataSchema.parse({}) as NonNullable<typeof stateData>);
            try { await useAppStore.getState().flushPendingSyncs(); }
            catch { /* A rejected cloud write must not prevent exporting its durable local copy. */ }
            if (!isCurrentSession(session)) throw new Error('Sessione cambiata.');
            let snapshot;
            try {
                snapshot = await collectBackupSnapshot(userData, !isGuest);
            } catch (error) {
                if (!isCurrentSession(session)) throw error;
                if (!(await showConfirm('Il backup completo del cloud non è disponibile. Vuoi esportare solo i dati presenti su questo dispositivo? La copia sarà indicata come parziale.'))) return;
                if (!isCurrentSession(session)) throw new Error('Sessione cambiata.');
                snapshot = await collectBackupSnapshot(userData, false);
            }
            if (!isCurrentSession(session)) throw new Error('Sessione cambiata.');
            const { Exporter } = await import('../lib/export');
            const identity = session.owner === 'guest' ? null : { uid: session.owner.slice(5) };
            if (prepareDownload) {
                const url = Exporter.prepareBackupJsonUrl(snapshot.data, identity, snapshot.coverage, snapshot.recovery);
                // The blob URL stays available until the user clicks the real
                // download link or leaves the page. No picker is invoked after await.
                if (!isCurrentSession(session)) {
                    URL.revokeObjectURL(url);
                    throw new Error('Sessione cambiata durante la preparazione del backup.');
                }
                preparedUrlRef.current = url;
                setPreparedBackupUrl(url);
            } else {
                const saved = await Exporter.exportBackupJson(snapshot.data, identity, snapshot.coverage, snapshot.recovery);
                if (!saved) await showAlert('Download annullato o non avviato. Riprova.');
            }
        } catch (error) {
            if (isCurrentSession(session)) void showAlert(error instanceof Error ? error.message : 'Backup non riuscito.');
        } finally {
            exportBusy.current = false;
            setExportingData(false);
        }
    };

    const handleExportBackup = () => performBackupExport(false);
    const handlePrepareBackup = () => performBackupExport(true);

    const handleImportFile = async (e: React.ChangeEvent<HTMLInputElement>, mode: ImportMode = 'merge') => {
        const file = e.target.files?.[0];
        if (!file || importBusy.current) return;
        importBusy.current = true;
        setImportingData(true);
        try {
            const { Exporter } = await import('../lib/export');
            await Exporter.importFromJson(file, currentUser, saveUserData, mode);
        } catch (error) {
            console.error("Import error:", error);
        } finally {
            importBusy.current = false;
            setImportingData(false);
            if (e.target) {
                e.target.value = '';
            }
        }
    };


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
                'Verranno eliminati definitivamente dal cloud e da questo dispositivo allenamenti, nutrizione, misurazioni, schede, bozze e copie di recupero.\\n\\nIl tuo account Firebase (email e accesso) resterà esistente, ma verrai disconnesso. Dispositivi offline e backup JSON già scaricati possono ancora conservare copie: non possono essere cancellati da TheLogBook a distanza.\\n\\nEsporta prima un backup solo se desideri conservare una copia dei dati. Vuoi procedere?'
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
            await showAlert('Dati cloud e dati di questo dispositivo eliminati. Il tuo account non è stato cancellato: puoi accedere di nuovo. Eventuali dispositivi rimasti offline potrebbero conservare copie precedenti.', 'Cancellazione completata');
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
        currentUser, handleLogout, handleLogoutEverywhere, revokingSessions,
        dob, setDob,
        height, setHeight,
        gender, setGender,
        deletingAccount,
        deletionPhase,
        pendingAccountDeletion, erasingHealthData, handleDeleteHealthData,
        importingData,
        exportingData,
        handleSaveProfile,
        handleExportCSV, handleExportShare, handleExportBackup, handlePrepareBackup,
        preparedBackupUrl, releasePreparedBackup, handleImportFile,
        handleDeleteAccount
    };
}