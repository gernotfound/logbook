import { useDialogStore } from '../store/useDialogStore';
import { useAppStore } from '../store/useAppStore';
import { Logic } from './logic';
import { createBackup, decodeImport, prepareImport, type BackupCoverage, type ImportMode } from './backup';
import { captureSession, isCurrentSession } from './sync/session';
import equal from 'fast-deep-equal';
import type { ExportShareOptions, TrainingCycle, UserData, WorkoutRoutine } from '../types';

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
            format: 'logbook-backup',
            version: 1,
            exportedAt: new Date().toISOString(),
            reason: 'logout-with-unsynced-data',
            userData: {
                profile: userData.profile,
                library: userData.library,
                routines: userData.routines,
                customFoods: userData.customFoods,
                activeWorkout: userData.activeWorkout,
                trainingCycles: userData.trainingCycles,
                activeCycleId: userData.activeCycleId,
                nutritionPlanning: userData.nutritionPlanning,
                supplements: userData.supplements,
                activePains: userData.activePains,
                catalogOverrides: userData.catalogOverrides,
                legalConsent: userData.legalConsent,
                nutritionPlanningOrigin: userData.nutritionPlanningOrigin,
                pendingConflicts: userData.pendingConflicts,
                history: userData.history,
                nutrition: userData.nutrition,
            }
        };

        const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        const dateStr = new Date().toISOString().split('T')[0];
        a.download = `logbook_emergency_backup_${dateStr}.json`;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        setTimeout(() => URL.revokeObjectURL(url), 100);
    },

    formatCsvField(value: any): string {
        if (value === null || value === undefined) return "";

        if (typeof value === 'number' || typeof value === 'boolean') {
            return String(value);
        }

        let str = String(value);

        if (/^-\d/.test(str)) {
             return `"${str.replace(/"/g, '""')}"`;
        }

        const trimmed = str.trimStart();
        if (/^[=+\-@\t\r]/.test(trimmed) || /^[\uFEFF\xA0]*[=+\-@\t\r]/.test(str)) {
            str = "'" + str;
        }

        return `"${str.replace(/"/g, '""')}"`;
    },

    formatCsvRow(fields: Array<string | number | boolean | null | undefined>): string {
        return fields.map(field => this.formatCsvField(field)).join(",") + "\n";
    },

    async exportToCSV(history: any[], nutrition: Record<string, any>, library: any[] = []) {
        const libMap = new Map<string, any>(library.map(l => [l.id, l]));
        let workoutCsv = "Data,Nome allenamento,Esercizio,Serie,Ripetizioni,Tempo,Peso (kg),Distanza (km),Velocità (km/h),Inclinazione,Kcal bruciate,Durata Sessione,Umore,Pump,Fatica,Acqua (L)\n";

        history.forEach(session => {
            const dateStr = session.globalStartTime
                ? new Date(session.globalStartTime).toLocaleString()
                : (session.date || "Data sconosciuta");
            const routineName = session.routineName || 'Allenamento libero';

            const sessionDuration = session.globalDurationStr || session.manualDurationStr || "";
            const mood = session.moodRating || "";
            const pump = session.pumpRating || "";
            const fatigue = session.fatigueRating || "";
            const water = session.waterLiters !== undefined ? session.waterLiters : "";

            if (session.exercises && session.exercises.length > 0) {
                session.exercises.forEach((ex: any) => {
                    const libEx = libMap.get(ex.exId);
                    const exName = libEx ? libEx.name : (ex.name || ex.exId || 'Sconosciuto');

                    if (ex.sets && ex.sets.length > 0) {
                        ex.sets.forEach((set: any, idx: number) => {
                            const kg = set.kg !== undefined ? set.kg : (set.weight !== undefined ? set.weight : "");
                            const reps = set.reps !== undefined ? set.reps : "";
                            const time = set.time !== undefined ? set.time : "";
                            const distance = set.distance !== undefined ? set.distance : "";
                            const speed = set.speed !== undefined ? set.speed : "";
                            const incline = set.incline !== undefined ? set.incline : "";
                            const kcal = set.kcal !== undefined ? set.kcal : "";

                            workoutCsv += this.formatCsvRow([
                                dateStr, routineName, exName, idx + 1, reps, time, kg, distance, speed, incline, kcal,
                                sessionDuration, mood, pump, fatigue, water
                            ]);

                            if (set.dropsets && set.dropsets.length > 0) {
                                set.dropsets.forEach((ds: any, dsIdx: number) => {
                                    const dsKg = ds.kg !== undefined ? ds.kg : "";
                                    const dsReps = ds.reps !== undefined ? ds.reps : "";
                                    const label = set.dropsets.length > 1 ? `${idx + 1} (Dropset ${dsIdx + 1})` : `${idx + 1} (Dropset)`;
                                    workoutCsv += this.formatCsvRow([
                                        dateStr, routineName, exName, label, dsReps, "", dsKg, "", "", "", "",
                                        sessionDuration, mood, pump, fatigue, water
                                    ]);
                                });
                            }

                            if (set.isometrics && set.isometrics.length > 0) {
                                set.isometrics.forEach((iso: any, isoIdx: number) => {
                                    const isoKg = iso.kg !== undefined ? iso.kg : "";
                                    const isoTime = iso.time ? `${iso.time}s` : "";
                                    const label = set.isometrics.length > 1 ? `${idx + 1} (Isometria ${isoIdx + 1})` : `${idx + 1} (Isometria)`;
                                    workoutCsv += this.formatCsvRow([
                                        dateStr, routineName, exName, label, "", isoTime, isoKg, "", "", "", "",
                                        sessionDuration, mood, pump, fatigue, water
                                    ]);
                                });
                            }
                        });
                    }
                });
            }
        });

        let nutritionCsv = "Data,Peso (kg),Kcal,Carbo (g),Pro (g),Grassi (g),BF (%),Collo (cm),Torace (cm),Spalle (cm),Braccia (cm),Vita (cm),Fianchi (cm),Cosce (cm),Polpacci (cm),Ore sonno,Sonno profondo,Sonno leggero,Sonno REM,Tempo sveglio,Note\n";
        const nutritionDates = Object.keys(nutrition).sort();
        nutritionDates.forEach(date => {
            const n = nutrition[date];
            const sHours = Logic.formatSleepTime(n.sleepHours);
            const sDeep = Logic.formatSleepTime(n.sleepDeep);
            const sLight = Logic.formatSleepTime(n.sleepLight);
            const sRem = Logic.formatSleepTime(n.sleepRem);
            const sAwake = Logic.formatSleepTime(n.sleepAwake);

            nutritionCsv += this.formatCsvRow([
                date, n.weight, n.kcal, n.carbs, n.pro, n.fat, n.bf,
                n.neck, n.chest, n.shoulders, n.biceps, n.waist, n.hips || n.hip, n.thighs, n.calves,
                sHours, sDeep, sLight, sRem, sAwake, n.notes
            ]);
        });

        const workoutHeader = "Data,Nome allenamento,Esercizio,Serie,Ripetizioni,Tempo,Peso (kg),Distanza (km),Velocità (km/h),Inclinazione,Kcal bruciate,Durata Sessione,Umore,Pump,Fatica,Acqua (L)\n";
        if (workoutCsv !== workoutHeader) {
            this.downloadFile("allenamenti.csv", workoutCsv, "text/csv;charset=utf-8;");
        } else {
            useDialogStore.getState().showAlert("Nessun allenamento da esportare.");
        }
        if (nutritionDates.length > 0) {
            setTimeout(() => {
                this.downloadFile("misurazioni.csv", nutritionCsv, "text/csv;charset=utf-8;");
            }, 500);
        }
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
                    useDialogStore.getState().showAlert("Esportazione fallita, riprova.");
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
        const payload = {
            version: 1,
            type: 'share',
            exportedAt: new Date().toISOString(),
            ...shareData,
        };

        const content = JSON.stringify(payload, null, 2);
        if (await this.downloadFile("logbook_condivisione.json", content, 'application/json') === false) return;

        return {
            libraryCount: shareData.library.length,
            routinesCount: shareData.routines.length,
            cyclesCount: shareData.trainingCycles.length
        };
    },

    async exportBackupJson(userData: UserData, currentUser: { uid: string } | null, coverage?: BackupCoverage, recovery?: unknown) {
        const payload = createBackup(userData, currentUser ? 'user:' + currentUser.uid : 'guest', coverage, recovery);
        await this.downloadFile("logbook_backup.json", JSON.stringify(payload, null, 2), 'application/json');
    },

    async importFromJson(
        file: File,
        _currentUser: { uid: string } | null,
        saveUserData: (update: (previous: UserData | null) => UserData) => Promise<unknown>,
        mode: ImportMode = 'merge'
    ) {
        const session = captureSession();
        const assertCurrent = () => {
            if (!isCurrentSession(session)) throw new Error('Sessione cambiata: importazione annullata.');
        };
        try {
            const content = await new Promise<string>((resolve, reject) => {
                const reader = new FileReader();
                reader.onload = () => resolve(String(reader.result));
                reader.onerror = () => reject(new Error('Impossibile leggere il file.'));
                reader.onabort = () => reject(new Error('Lettura del file annullata.'));
                reader.readAsText(file);
            });
            assertCurrent();
            const decoded = decodeImport(JSON.parse(content), session.owner);
            const snapshot = structuredClone(useAppStore.getState().userData);
            if (!snapshot) throw new Error('Dati locali non ancora disponibili.');
            const selectedMode = decoded.share ? 'merge' : mode;
            const prepared = prepareImport(snapshot, decoded.data, selectedMode);
            const summary = (selectedMode === 'restore' ? 'Ripristino' : 'Importazione incrementale') +
                ': ' + (prepared.data.history?.length ?? 0) + ' allenamenti, ' + Object.keys(prepared.data.nutrition ?? {}).length +
                ' giornate, ' + (prepared.data.library?.length ?? 0) + ' esercizi.\n' + prepared.collisions + ' collisioni su identificativi o giornate.\n' +
                (selectedMode === 'restore' ? 'I campi presenti nel file sostituiranno i dati locali corrispondenti.' : 'In caso di collisione saranno conservati i valori locali.') +
                (decoded.ownerUnknown ? '\nIl vecchio formato non identifica il proprietario. Conferma solo se questi dati sono tuoi.' : '') +
                '\nI consensi importati non verranno applicati.\nProcedere?';
            if (!(await useDialogStore.getState().showConfirm(summary, 'Anteprima importazione'))) return;
            assertCurrent();
            await saveUserData(previous => {
                assertCurrent();
                if (!equal(previous, snapshot)) throw new Error('I dati sono cambiati durante l’anteprima. Ripeti l’importazione.');
                return prepared.data;
            });
            assertCurrent();
            const status = useAppStore.getState().syncHealth;
            void useDialogStore.getState().showAlert(status === 'local-pending'
                ? 'Importazione salvata sul dispositivo. Sincronizzazione cloud in attesa.'
                : 'Importazione completata.');
        } catch (error) {
            if (isCurrentSession(session)) void useDialogStore.getState().showAlert(error instanceof Error ? error.message : "Errore durante l'importazione.");
            throw error;
        }
    }
};
