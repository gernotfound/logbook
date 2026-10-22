import { useDialogStore } from '../store/useDialogStore';
import { useAppStore } from '../store/useAppStore';
import { Logic } from './logic';
import { createBackup, createShareBackup, decodeImport, prepareImport, type BackupCoverage, type ImportMode } from './backup';
import { restoreMissingBackupDeviceDrafts } from './backupDeviceRecovery';
import { restorePortableWorkout, restorePortableTimerAsPaused } from './backupWorkoutRecovery';
import { captureSession, isCurrentSession } from './sync/session';
import { readLocal } from './sync/localRepository';
import equal from 'fast-deep-equal';
import type { Exercise, ExportShareOptions, NutritionDay, TrainingCycle, UserData, WorkoutRoutine, WorkoutSession, SyncResult } from '../types';
import { buildCsvFiles, formatCsvField, formatCsvRow } from './csvExport';
import { parseLargeBackupJson } from './streamJsonImport';

export const MAX_JSON_IMPORT_BYTES = 64 * 1024 * 1024;

const DEFAULT_SHARE_OPTIONS: Required<ExportShareOptions> = {
    exportLibrary: true,
    exportRoutines: true,
    exportTrainingCycles: true,
};

export function buildShareExportData(userData: UserData, options: ExportShareOptions = DEFAULT_SHARE_OPTIONS) {
    const library = userData.library ?? [];
    const routines = userData.routines ?? [];
    const trainingCycles = userData.trainingCycles ?? [];
    const libraryById = new Map(library.map(item => [item.id, item]));
    const routinesById = new Map(routines.map(item => [item.id, item]));
    const cyclesById = new Map(trainingCycles.map(item => [item.id, item]));
    const libraryIds = new Set<string>();
    const routineIds = new Set<string>();
    const cycleIds = new Set<string>();

    const addSelection = <T extends { id: string }>(
        selection: boolean | string[] | undefined,
        source: T[],
        sourceById: Map<string, T>,
        target: Set<string>,
    ) => {
        if (selection === true) {
            source.forEach(item => target.add(item.id));
            return;
        }
        if (Array.isArray(selection)) {
            selection.forEach(id => {
                if (sourceById.has(id)) target.add(id);
            });
        }
    };

    addSelection(options.exportTrainingCycles, trainingCycles, cyclesById, cycleIds);
    addSelection(options.exportRoutines, routines, routinesById, routineIds);
    addSelection(options.exportLibrary, library, libraryById, libraryIds);

    cycleIds.forEach(cycleId => {
        const cycle = cyclesById.get(cycleId);
        cycle?.routines.forEach(item => {
            if (routinesById.has(item.routineId)) routineIds.add(item.routineId);
        });
    });

    routineIds.forEach(routineId => {
        const routine = routinesById.get(routineId);
        routine?.exercises.forEach(item => {
            if (libraryById.has(item.exId)) libraryIds.add(item.exId);
        });
    });

    const finalLibrary = library.filter(item => libraryIds.has(item.id));
    const finalRoutines: WorkoutRoutine[] = routines
        .filter(item => routineIds.has(item.id))
        .map(item => ({
            ...item,
            exercises: item.exercises.filter(exercise => libraryIds.has(exercise.exId)),
        }));
    const finalCycles: TrainingCycle[] = trainingCycles
        .filter(item => cycleIds.has(item.id))
        .map(item => ({
            ...item,
            routines: item.routines.filter(routine => routineIds.has(routine.routineId)),
        }));

    return {
        library: finalLibrary,
        routines: finalRoutines,
        trainingCycles: finalCycles,
    };
}

export const Exporter = {
    exportEmergencyJSON(userData: UserData): void {
        const payload = {
            ...createBackup(userData, captureSession().owner, { scope: 'device', months: [] }),
            reason: 'logout-with-unsynced-data',
        };

        const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        const dateStr = Logic.getLocalDateString();
        a.download = `logbook_emergency_backup_${dateStr}.json`;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        setTimeout(() => URL.revokeObjectURL(url), 100);
    },

    formatCsvField(value: unknown): string {
        return formatCsvField(value);
    },

    formatCsvRow(fields: Array<string | number | boolean | null | undefined>): string {
        return formatCsvRow(fields);
    },

    async exportToCSV(
        history: WorkoutSession[],
        nutrition: Record<string, NutritionDay>,
        library: Array<Pick<Exercise, 'id' | 'name'>> = [],
    ) {
        const outputs = buildCsvFiles(history, nutrition, library);
        if (!history.length) {
            await useDialogStore.getState().showAlert('Nessun allenamento da esportare.');
        }
        for (const [filename, content] of outputs) {
            const saved = await this.downloadFile(filename, content, 'text/csv;charset=utf-8;');
            if (saved === false) return false;
        }
        return true;
    },

    async downloadFile(filename: string, content: string, type: string = "text/csv;charset=utf-8;") {
        const prefix = type.includes("csv") ? "\uFEFF" : "";
        const blob = new Blob([prefix + content], { type });

        if (typeof window !== 'undefined' && 'showSaveFilePicker' in window) {
            try {
                const handle = await (window as any).showSaveFilePicker({
                    suggestedName: filename,
                    types: [{
                        description: type.includes("json") ? 'JSON File' : 'CSV File',
                        accept: type.includes("json") ? { 'application/json': ['.json'] } : { 'text/csv': ['.csv'] },
                    }],
                });
                const writable = await handle.createWritable();
                await writable.write(blob);
                await writable.close();
                return true;
            } catch (err: any) {
                if (err.name === 'AbortError') {
                    return false;
                }
                if (err.name === 'SecurityError' || err.name === 'TypeError') {
                    console.warn("showSaveFilePicker bloccato, uso fallback nativo:", err);
                } else {
                    console.error("Esportazione fallita:", err);
                    void useDialogStore.getState().showAlert("Esportazione fallita, riprova.");
                    return false;
                }
            }
        }

        const link = document.createElement("a");
        const url = URL.createObjectURL(blob);
        link.setAttribute("href", url);
        link.setAttribute("download", filename);
        link.style.visibility = 'hidden';
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
        URL.revokeObjectURL(url);
        return true;
    },

    async exportShareJson(
        userData: UserData,
        options: ExportShareOptions = DEFAULT_SHARE_OPTIONS
    ): Promise<{ libraryCount: number; routinesCount: number; cyclesCount: number } | undefined> {
        const shareData = buildShareExportData(userData, options);
        const payload = createShareBackup(shareData);

        const content = JSON.stringify(payload, null, 2);
        if (await this.downloadFile("logbook_condivisione.json", content, 'application/json') === false) return;

        return {
            libraryCount: shareData.library.length,
            routinesCount: shareData.routines.length,
            cyclesCount: shareData.trainingCycles.length
        };
    },

    prepareBackupJsonUrl(userData: UserData, currentUser: { uid: string } | null, coverage?: BackupCoverage, recovery?: unknown): string {
        const payload = createBackup(userData, currentUser ? 'user:' + currentUser.uid : 'guest', coverage, recovery);
        return URL.createObjectURL(new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' }));
    },

    async exportBackupJson(userData: UserData, currentUser: { uid: string } | null, coverage?: BackupCoverage, recovery?: unknown): Promise<boolean> {
        const payload = createBackup(userData, currentUser ? 'user:' + currentUser.uid : 'guest', coverage, recovery);
        return this.downloadFile("logbook_backup.json", JSON.stringify(payload, null, 2), 'application/json');
    },

    async importFromJson(
        file: File,
        _currentUser: { uid: string } | null,
        saveUserData: (
            update: (previous: UserData | null) => UserData,
            options?: { expectedRevision?: number },
        ) => Promise<SyncResult>,
        mode: ImportMode = 'merge'
    ) {
        const session = captureSession();
        const assertCurrent = () => {
            if (!isCurrentSession(session)) throw new Error('Sessione cambiata: importazione annullata.');
        };
        try {
            // The threshold selects the read strategy, never whether a genuine
            // backup is recoverable. Large JSON is decoded in bounded chunks.
            const parsed = file.size > MAX_JSON_IMPORT_BYTES
                ? await parseLargeBackupJson(file, assertCurrent)
                : JSON.parse(await new Promise<string>((resolve, reject) => {
                    const reader = new FileReader();
                    reader.onload = () => resolve(String(reader.result));
                    reader.onerror = () => reject(new Error('Impossibile leggere il file.'));
                    reader.onabort = () => reject(new Error('Lettura del file annullata.'));
                    reader.readAsText(file);
                }));
            assertCurrent();
            const decoded = decodeImport(parsed, session.owner);
            const durableEnvelope = await readLocal(session.owner);
            assertCurrent();
            if (!durableEnvelope) throw new Error('Dati locali non ancora disponibili.');
            const storeSnapshot = structuredClone(useAppStore.getState().userData);
            if (!storeSnapshot || !equal(storeSnapshot, durableEnvelope.data)) {
                throw new Error('I dati locali stanno ancora cambiando. Attendi il salvataggio e ripeti l’importazione.');
            }
            const snapshot = structuredClone(durableEnvelope.data);
            const expectedRevision = durableEnvelope.revision;
            const selectedMode = decoded.share ? 'merge' : mode;
            const prepared = prepareImport(snapshot, decoded.data, selectedMode, decoded.coverage);
            const summary = (selectedMode === 'restore' ? 'Ripristino' : 'Importazione incrementale') +
                ': ' + (prepared.data.history?.length ?? 0) + ' allenamenti, ' + Object.keys(prepared.data.nutrition ?? {}).length +
                ' giornate, ' + (prepared.data.library?.length ?? 0) + ' esercizi.\n' + prepared.collisions + ' collisioni su identificativi o giornate.\n' +
                (selectedMode === 'restore' ? 'I campi presenti nel file sostituiranno i dati locali corrispondenti.' : 'In caso di collisione saranno conservati i valori locali.') +
                (selectedMode === 'restore' && decoded.coverage?.scope === 'device'
                    ? '\nIl backup è parziale: storico e nutrizione non presenti nel file saranno conservati.'
                    : '') +
                (decoded.ownerUnknown ? '\nIl backup non identifica un proprietario. Conferma solo se questi dati sono tuoi.' : '') +
                (decoded.hasDeviceRecovery ? '\nIl file contiene dati di recupero. Le bozze valide possono essere ripristinate separatamente e, se possibile, anche l’allenamento interrotto con timer in pausa. Le testimonianze tecniche degli editor e il journal causale originale restano esclusivamente nel backup e NON vengono trapiantati; conserva il file originale.' : '') +
                (decoded.deviceDraftRecoveryWarning
                    ? '\nATTENZIONE: ' + decoded.deviceDraftRecoveryWarning +
                      ' Le bozze del file NON saranno ripristinate in questa importazione. Il backup originale rimane indispensabile per un recupero successivo; i dati principali possono essere importati separatamente.'
                    : '') +
                '\nI consensi importati non verranno applicati.\nProcedere?';
            if (!(await useDialogStore.getState().showConfirm(summary, 'Anteprima importazione'))) return;
            assertCurrent();
            const latestEnvelope = await readLocal(session.owner);
            assertCurrent();
            if (!latestEnvelope || latestEnvelope.revision !== expectedRevision) {
                throw new Error('I dati sono cambiati durante l’anteprima. Ripeti l’importazione.');
            }
            const saveResult = await saveUserData(previous => {
                assertCurrent();
                if (!equal(previous, snapshot)) throw new Error('I dati sono cambiati durante l’anteprima. Ripeti l’importazione.');
                return prepared.data;
            }, { expectedRevision });
            assertCurrent();
            // A resolved Promise does not prove that a local commit succeeded:
            // update-required and other fail-closed boundaries return SyncResult
            // without throwing. Do not proceed to optional device recovery then.
            if (!saveResult.ok && saveResult.status !== 'local-pending') {
                throw new Error('Importazione non confermata: il salvataggio è stato bloccato. Conserva il backup originale e riprova dopo aver risolto il problema.', { cause: saveResult.error });
            }
            let draftReport = decoded.deviceDraftRecoveryWarning
                ? ' Bozze non ripristinate: conserva il backup originale per il recupero.' : '';
            if (decoded.deviceDrafts.length && await useDialogStore.getState().showConfirm(
                'Il backup contiene ' + decoded.deviceDrafts.length + ' bozze recuperabili. Ripristinare soltanto quelle assenti dal dispositivo? Le bozze esistenti non saranno sovrascritte.')) {
                try {
                    assertCurrent();
                    const { restored, preserved } = restoreMissingBackupDeviceDrafts(
                        decoded.deviceDrafts, session.owner, assertCurrent);
                    draftReport = ' Bozze recuperate: ' + restored + '; bozze già presenti conservate: ' + preserved + '.';
                } catch (error) {
                    draftReport = ' Il recupero delle bozze non è terminato: conserva il backup e riprova. ' +
                        (error instanceof Error ? error.message : '');
                }
            }
            if (decoded.deviceWorkoutRaw && await useDialogStore.getState().showConfirm(
                'Il backup contiene un allenamento rimasto sul vecchio dispositivo. Provare a recuperarlo come nuova modifica locale, solo se nessun allenamento è già aperto? Il timer eventualmente incluso verrà ripristinato IN PAUSA, senza continuare a contare il tempo trascorso dopo il backup.')) {
                try {
                    assertCurrent();
                    const outcome = await restorePortableWorkout(
                        decoded.deviceWorkoutRaw, session.owner,
                        () => useAppStore.getState(),
                        workout => useAppStore.getState().setSyncedLocalWorkout(workout),
                        assertCurrent,
                    );
                    if (outcome === 'restored') {
                        const timerRestored = restorePortableTimerAsPaused(
                            decoded.deviceTimerRaw, decoded.exportedAt, session.owner, assertCurrent);
                        draftReport += ' Allenamento recuperato nel journal del dispositivo corrente.' +
                            (timerRestored ? ' Timer recuperato in pausa.' : '');
                    } else {
                        draftReport += ' Allenamento del backup non sovrascritto: ' +
                            (outcome === 'already-present' ? 'esiste già una sessione locale.' :
                             outcome === 'completed' ? 'la sessione è già nello storico.' : 'è attiva un’altra sessione.') +
                            ' Conserva il backup.';
                    }
                } catch (error) {
                    draftReport += ' Recupero allenamento incompleto: mantieni il backup originale. ' +
                        (error instanceof Error ? error.message : '');
                }
            }
            assertCurrent();
            void useDialogStore.getState().showAlert((saveResult.status === 'local-pending'
                ? 'Importazione salvata sul dispositivo. Sincronizzazione cloud in attesa.'
                : 'Importazione completata.') + draftReport);
        } catch (error) {
            if (isCurrentSession(session)) void useDialogStore.getState().showAlert(error instanceof Error ? error.message : "Errore durante l'importazione.");
            throw error;
        }
    }
};
