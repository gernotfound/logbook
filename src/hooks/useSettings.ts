import { useRef, useState } from 'react';
import { useAuth } from './useAuth';
import { useAppStore } from '../store/useAppStore';
import { useDialogStore } from '../store/useDialogStore';
import { DB } from '../lib/db';
import { captureSession, isCurrentSession } from '../lib/sync/session';
import { collectBackupSnapshot } from '../lib/db/backupSnapshot';
import type { ImportMode } from '../lib/backup';
import { isAccountDeletionPending } from '../lib/sync/accountGate';
import {
    isSensitiveReauthCancellation,
    reauthenticateForSensitiveAction,
} from '../lib/auth/recentAuth';
import { reportError } from '../lib/errorHandler';

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
        if (isGuest) {
            await logout({ mode: 'normal' });
        } else if (await showConfirm("Sei sicuro di voler uscire dal tuo account?")) {
            await logout({ mode: 'normal' });
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
    const [importingData, setImportingData] = useState(false);
    const importBusy = useRef(false);
    const exportBusy = useRef(false);
    const [exportingData, setExportingData] = useState(false);
    let pendingAccountDeletion = false;
    try { pendingAccountDeletion = isAccountDeletionPending(captureSession().owner); }
    catch { /* The writer separately refuses an unreadable deletion marker. */ }

    const handleSaveProfile = async (e?: any) => {
        if (e) e.preventDefault();
        const newProfile = { dob, height, gender };
        try {
            await dispatchDomainOperation({ type: 'profile.patch', patch: newProfile });
            setLocalProfile(null);
        } catch {
            await showAlert("Errore durante il salvataggio del profilo.");
        }
    };

    const handleExportCSV = async () => {
        const userData = useAppStore.getState().userData;
        if (!userData) return;
        try {
            const { Exporter } = await import('../lib/export');
            await Exporter.exportToCSV(userData.history || [], userData.nutrition || {}, userData.library || []);
        } catch (error) {
            console.error('Errore esportazione CSV:', error);
            await showAlert('Esportazione CSV non riuscita. Riprova.');
        }
    };

    const handleExportShare = async (options?: { exportLibrary?: boolean | string[], exportRoutines?: boolean | string[], exportTrainingCycles?: boolean | string[] }) => {
        const userData = useAppStore.getState().userData;
        if (!userData) return;
        try {
            const { Exporter } = await import('../lib/export');
            const result = await Exporter.exportShareJson(userData, options);
            if (result) {
                await showAlert(`Esportati con successo: ${result.cyclesCount} cicli, ${result.routinesCount} schede, ${result.libraryCount} esercizi.`);
            }
        } catch (error) {
            console.error('Errore esportazione condivisione:', error);
            await showAlert('Esportazione JSON non riuscita. Riprova.');
        }
    };

    const handleExportBackup = async () => {
        if (exportBusy.current) return;
        const userData = useAppStore.getState().userData;
        if (!userData) return;
        const session = captureSession();
        exportBusy.current = true;
        setExportingData(true);
        try {
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
            await Exporter.exportBackupJson(snapshot.data, session.owner === 'guest' ? null : { uid: session.owner.slice(5) }, snapshot.coverage, snapshot.recovery);
        } catch (error) {
            if (isCurrentSession(session)) void showAlert(error instanceof Error ? error.message : 'Backup non riuscito.');
        } finally {
            exportBusy.current = false;
            setExportingData(false);
        }
    };

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

    const handleDeleteAccount = async () => {
        if (deleteBusy.current) return;
        deleteBusy.current = true;
        let session: ReturnType<typeof captureSession> | null = null;
        try {
            session = captureSession();
            const assertCurrent = () => {
                if (!session || !isCurrentSession(session)) throw new Error('Sessione cambiata: cancellazione annullata.');
            };
            if (isGuest) {
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
            const { auth } = await import('../lib/firebase');
            assertCurrent();
            const user = auth.currentUser;
            if (!user || 'user:' + user.uid !== session.owner) throw new Error('Account cambiato.');

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
        currentUser, handleLogout,
        dob, setDob,
        height, setHeight,
        gender, setGender,
        deletingAccount,
        deletionPhase,
        pendingAccountDeletion,
        importingData,
        exportingData,
        handleSaveProfile,
        handleExportCSV, handleExportShare, handleExportBackup, handleImportFile,
        handleDeleteAccount
    };
}