import { useEffect, useRef, useState, type ChangeEvent } from 'react';
import type { useAuth } from './useAuth';
import { useAppStore } from '../store/useAppStore';
import { useDialogStore } from '../store/useDialogStore';
import { captureSession, isCurrentSession } from '../lib/sync/session';
import { collectBackupSnapshot, hasDeviceRecoveryBackupSource } from '../lib/db/backupSnapshot';
import { readLocal } from '../lib/sync/localRepository';
import { UserDataSchema } from '../lib/schema';
import { currentHealthConsentStatus } from '../lib/healthConsent';
import type { ImportMode } from '../lib/backup';

type TransferAuth = Pick<ReturnType<typeof useAuth>, 'currentUser' | 'isGuest'>;

export function useSettingsTransfers({ currentUser, isGuest }: TransferAuth) {
    // Bulk import is the sole snapshot-save boundary in the settings UI.
    const saveUserData = useAppStore(state => state.saveUserData);
    const showAlert = useDialogStore(state => state.showAlert);
    const showConfirm = useDialogStore(state => state.showConfirm);

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
        // A quarantined workout must remain exportable by its owner even when
        // the authenticated UI deliberately refuses to hydrate it.
        const protectedDeviceBackup = session.owner !== 'guest' && state.localPersistenceBlocked === true
            && currentHealthConsentStatus(session.owner.slice(5)) === 'active';
        if (!stateData && !protectedDeviceBackup
            && (session.owner === 'guest' || currentHealthConsentStatus(session.owner.slice(5)) === 'active')) {
            await showAlert('I dati non sono ancora disponibili. Attendi il caricamento prima di esportare.');
            return;
        }
        releasePreparedBackup();
        exportBusy.current = true;
        setExportingData(true);
        try {
            const envelope = stateData ? undefined : await readLocal(session.owner);
            // An empty fallback is useful for a cloud-only rights export, but
            // is not evidence that a local archive exists. Never offer it as a
            // device backup if the cloud scan fails.
            const hasDeviceBackupSource = stateData !== null || envelope !== undefined
                || (protectedDeviceBackup && hasDeviceRecoveryBackupSource(session.owner));
            const userData = stateData ?? envelope?.data ?? (UserDataSchema.parse({}) as NonNullable<typeof stateData>);
            if (protectedDeviceBackup) {
                if (!hasDeviceBackupSource) {
                    throw new Error('Backup locale non disponibile: nessun archivio o dato di recupero leggibile su questo dispositivo.');
                }
                if (!(await showConfirm(
                    'Il caricamento dei dati è bloccato per proteggere una copia locale di provenienza non verificata. Vuoi esportare SOLO il backup di questo dispositivo, contrassegnato come parziale? Il file può contenere copie storiche e registrazioni di recupero che non vengono reintegrate automaticamente. Non saranno riattivate o sincronizzate. Conserva il file in un luogo protetto.',
                ))) return;
            } else {
                try { await useAppStore.getState().flushPendingSyncs(); }
                catch { /* A rejected cloud write must not prevent exporting its durable local copy. */ }
            }
            if (!isCurrentSession(session)) throw new Error('Sessione cambiata.');
            let snapshot;
            try {
                snapshot = await collectBackupSnapshot(userData, !isGuest && !protectedDeviceBackup);
                if (protectedDeviceBackup && !stateData && !envelope
                    && !Object.keys(snapshot.recovery.device).length) {
                    throw new Error('Dati di recupero locali cambiati durante il backup: nessuna copia vuota esportata.');
                }
            } catch (error) {
                if (!isCurrentSession(session) || protectedDeviceBackup) throw error;
                if (!hasDeviceBackupSource) {
                    throw new Error('Backup locale non disponibile: nessun archivio leggibile su questo dispositivo. Il backup cloud non è riuscito; riprova senza sostituire eventuali copie precedenti.');
                }
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

    const handleImportFile = async (e: ChangeEvent<HTMLInputElement>, mode: ImportMode = 'merge') => {
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


    return {
        importingData, exportingData, preparedBackupUrl, releasePreparedBackup,
        handleExportCSV, handleExportShare, handleExportBackup, handlePrepareBackup,
        handleImportFile,
    };
}
