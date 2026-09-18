import { useRef, useState } from 'react';
import { useAuth } from './useAuth';
import { useAppStore } from '../store/useAppStore';
import { useDialogStore } from '../store/useDialogStore';
import { DB } from '../lib/db';
import { captureSession, isCurrentSession } from '../lib/sync/session';
import { collectBackupSnapshot } from '../lib/db/backupSnapshot';
import type { ImportMode } from '../lib/backup';
import { get } from 'idb-keyval';
import { isAccountDeletionPending } from '../lib/sync/accountGate';

export function useSettings() {
    const { currentUser, isGuest, logout } = useAuth();
    const storeProfile = useAppStore(state => state.userData?.profile);
    // Snapshot save is retained here only for the bulk import boundary.
    const saveUserData = useAppStore(state => state.saveUserData);
    const dispatchDomainOperation = useAppStore(state => state.dispatchDomainOperation);
    const showAlert = useDialogStore(state => state.showAlert);
    const showConfirm = useDialogStore(state => state.showConfirm);

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
            await showAlert("Profilo aggiornato!");
        } catch {
            await showAlert("Errore durante il salvataggio del profilo.");
        }
    };

    const handleExportCSV = async () => {
        const userData = useAppStore.getState().userData;
        if(userData) {
            const { Exporter } = await import('../lib/export');
            await Exporter.exportToCSV(userData.history || [], userData.nutrition || {}, userData.library || []);
        }
    };

    const handleExportShare = async (options?: { exportLibrary?: boolean | string[], exportRoutines?: boolean | string[], exportTrainingCycles?: boolean | string[] }) => {
        const userData = useAppStore.getState().userData;
        if(userData) {
            const { Exporter } = await import('../lib/export');
            const result = await Exporter.exportShareJson(userData, options);
            if (result) {
                showAlert(`Esportati con successo: ${result.cyclesCount} cicli, ${result.routinesCount} schede, ${result.libraryCount} esercizi.`);
            }
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

    const handleExportRecovery = async () => {
        const session = captureSession();
        try {
            const original = await get('logbook:recovery:legacy') ?? await get('logbook_cached_user_data');
            if (!isCurrentSession(session)) return;
            if (original === undefined) { void showAlert('Nessun archivio precedente da recuperare.'); return; }
            if (!(await showConfirm('Questo archivio precedente non identifica il proprietario. Esportalo solo se i dati su questo dispositivo sono tuoi. Il file originale resterà conservato.'))) return;
            if (!isCurrentSession(session)) return;
            const { Exporter } = await import('../lib/export');
            await Exporter.downloadFile('logbook_recupero_precedente.json', JSON.stringify({ format: 'logbook-backup', version: 1, userData: original, recovery: { localWorkout: localStorage.getItem('logbook_local_workout') } }, null, 2), 'application/json');
        } catch (error) {
            if (isCurrentSession(session)) void showAlert(error instanceof Error ? error.message : 'Recupero non riuscito.');
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
        const session = captureSession();
        const assertCurrent = () => {
            if (!isCurrentSession(session)) throw new Error('Sessione cambiata: cancellazione annullata.');
        };
        try {
            if (isGuest) {
                if (!(await showConfirm('Eliminare permanentemente i dati ospite di questo dispositivo?'))) return;
                assertCurrent();
                await logout({ mode: 'force' });
                return;
            }
            if (!(await showConfirm('Questa operazione è irreversibile: elimina allenamenti, nutrizione, misurazioni e account. Prima di continuare, chiudi LogBook sugli altri dispositivi ed esporta un backup se vuoi conservare i dati. Procedere?'))) return;
            assertCurrent();
            if (!(await showConfirm('Ultima conferma: eliminare definitivamente il tuo account LogBook?'))) return;
            assertCurrent();
            setDeletingAccount(true);
            const { auth, provider, reauthenticateWithPopup } = await import('../lib/firebase');
            assertCurrent();
            const user = auth.currentUser;
            if (!user || 'user:' + user.uid !== session.owner) throw new Error('Account cambiato.');
            if (user.providerData.some(item => item.providerId === 'google.com')) {
                await reauthenticateWithPopup(user, provider);
                assertCurrent();
            }
            const outcome = await DB.deleteAccount();
            if (outcome.status === 'pending') await showAlert(outcome.message);
        } catch (error) {
            if (captureSession().owner === session.owner) void showAlert(error instanceof Error ? error.message : 'Cancellazione non riuscita.');
        } finally {
            deleteBusy.current = false;
            setDeletingAccount(false);
        }
    };
    return {
        currentUser, handleLogout,
        dob, setDob,
        height, setHeight,
        gender, setGender,
        deletingAccount,
        pendingAccountDeletion,
        importingData,
        exportingData, handleExportRecovery,
        handleSaveProfile,
        handleExportCSV, handleExportShare, handleExportBackup, handleImportFile,
        handleDeleteAccount
    };
}
