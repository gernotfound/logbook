import { useDialogStore } from '../store/useDialogStore';
import { useAppStore } from '../store/useAppStore';
import { Logic } from './logic';
import { createBackup, decodeImport, prepareImport, type BackupCoverage, type ImportMode } from './backup';
import { captureSession, isCurrentSession } from './sync/session';
import { readLocal } from './sync/localRepository';
import equal from 'fast-deep-equal';
import type { Exercise, ExportShareOptions, NutritionDay, SessionExercise, SessionExerciseSet, TrainingCycle, UserData, WorkoutRoutine, WorkoutSession } from '../types';
import { requireCanonicalWorkoutDate } from './sync/monthlyIntegrity';

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

    formatCsvField(value: any): string {
        if (value === null || value === undefined) return "";

        if (typeof value === 'number' || typeof value === 'boolean') {
            return String(value);
        }

        let str = String(value);
        const trimmed = str.replace(/^[\s\uFEFF\u00A0]+/, '');
        if (/^[=+\-@]/.test(trimmed)) {
            str = "'" + str;
        }

        return `"${str.replace(/"/g, '""')}"`;
    },

    formatCsvRow(fields: Array<string | number | boolean | null | undefined>): string {
        return fields.map(field => this.formatCsvField(field)).join(",") + "\n";
    },

    async exportToCSV(
        history: WorkoutSession[],
        nutrition: Record<string, NutritionDay>,
        library: Array<Pick<Exercise, 'id' | 'name'>> = [],
    ) {
        const libMap = new Map(library.map(item => [item.id, item]));
        const jsonCell = (value: unknown) => value === undefined || value === null ? '' : JSON.stringify(value);
        const isoInstant = (value: number | undefined) =>
            typeof value === 'number' && Number.isFinite(value) ? new Date(value).toISOString() : '';

        const workoutHeaders = [
            'Data', 'Nome allenamento', 'Esercizio', 'Serie', 'Tecnica', 'Segmento',
            'Ripetizioni', 'RIR', 'Tempo', 'Peso (kg)', 'Recupero precedente (s)', 'Target reps',
            'Distanza (km)', 'Velocità (km/h)', 'Inclinazione', 'Kcal bruciate', 'Standard tecnico',
            'Durata Sessione', 'Umore', 'Pump', 'Fatica', 'Acqua (L)',
            'Energia pre-sessione', 'Stress pre-sessione', 'Motivazione pre-sessione', 'Recupero muscolare pre-sessione',
            'ID sessione', 'Inizio UTC', 'Fine UTC', 'ID routine', 'ID ciclo', 'Nome ciclo', 'Strategia ciclo',
            'Readiness rilevata UTC', 'Dolori', 'ID esercizio sessione', 'ID esercizio libreria',
            'Nota sessione', 'Contratto progressione', 'ID serie', 'Modalità esecuzione', 'ID segmento',
        ];
        let workoutCsv = workoutHeaders.join(',') + '\n';

        const appendWorkoutRow = (
            session: WorkoutSession,
            exercise?: SessionExercise,
            set?: SessionExerciseSet,
            setLabel: string | number = '',
            technique = '',
            segmentIndex: string | number = '',
            segmentId = '',
            reps: string | number = '',
            rir: string | number = '',
            time = '',
            kg: string | number = '',
            restBefore: string | number = '',
            targetReps: string | number = '',
            distance = '',
            speed = '',
            incline = '',
            kcal = '',
        ) => {
            const readiness = session.readiness;
            const exName = exercise
                ? (libMap.get(exercise.exId)?.name ?? exercise.exId ?? 'Sconosciuto')
                : '';
            workoutCsv += this.formatCsvRow([
                requireCanonicalWorkoutDate(session),
                session.routineName || 'Allenamento libero',
                exName,
                setLabel,
                technique,
                segmentIndex,
                reps,
                rir,
                time,
                kg,
                restBefore,
                targetReps,
                distance,
                speed,
                incline,
                kcal,
                exercise?.technicalStandard ?? '',
                session.globalDurationStr || session.manualDurationStr || '',
                session.moodRating ?? '',
                session.pumpRating ?? '',
                session.fatigueRating ?? '',
                session.waterLiters ?? '',
                readiness?.energy ?? '',
                readiness?.stress ?? '',
                readiness?.motivation ?? '',
                readiness?.muscleRecovery ?? '',
                session.id ?? '',
                isoInstant(session.globalStartTime),
                isoInstant(session.globalEndTime ?? session.endTime),
                session.routineId ?? '',
                session.cycleId ?? '',
                session.cycleName ?? '',
                jsonCell(session.cycleStrategy),
                isoInstant(readiness?.capturedAt),
                jsonCell(session.pains ?? []),
                exercise?.id ?? '',
                exercise?.exId ?? '',
                exercise?.sessionNote ?? '',
                jsonCell(exercise?.progressionContract),
                set?.id ?? '',
                set?.executionMode ?? '',
                segmentId,
            ]);
        };

        for (const session of history) {
            if (!session.exercises?.length) {
                appendWorkoutRow(session);
                continue;
            }
            for (const exercise of session.exercises) {
                if (!exercise.sets?.length) {
                    appendWorkoutRow(session, exercise);
                    continue;
                }
                exercise.sets.forEach((set, setIndex) => {
                    const technique = set.technique || (set.dropsets?.length ? 'dropset' : 'straight');
                    appendWorkoutRow(
                        session, exercise, set, setIndex + 1, technique, 0, '',
                        set.reps ?? '', set.rir ?? '', set.time ?? '', set.kg ?? '', '',
                        set.target?.reps ?? '', set.distance ?? '', set.speed ?? '', set.incline ?? '', set.kcal ?? '',
                    );

                    set.segments?.forEach((segment, segmentIndex) => {
                        appendWorkoutRow(
                            session, exercise, set, setIndex + 1, segment.technique || set.technique || 'straight',
                            segmentIndex + 1, segment.id, segment.reps ?? '', '', segment.time ?? '', segment.kg ?? '',
                            segment.restBeforeSeconds ?? '', segment.target?.reps ?? set.target?.reps ?? '',
                        );
                    });
                    set.dropsets?.forEach((drop, dropIndex) => {
                        const label = set.dropsets && set.dropsets.length > 1
                            ? `${setIndex + 1} (Dropset ${dropIndex + 1})`
                            : `${setIndex + 1} (Dropset)`;
                        appendWorkoutRow(
                            session, exercise, set, label, 'dropset', dropIndex + 1, drop.id,
                            drop.reps ?? '', '', '', drop.kg ?? '',
                        );
                    });
                    set.isometrics?.forEach((iso, isoIndex) => {
                        const label = set.isometrics && set.isometrics.length > 1
                            ? `${setIndex + 1} (Isometria ${isoIndex + 1})`
                            : `${setIndex + 1} (Isometria)`;
                        appendWorkoutRow(
                            session, exercise, set, label, 'isometry', isoIndex + 1, iso.id,
                            '', '', iso.time ? `${iso.time}s` : '', iso.kg ?? '',
                        );
                    });
                });
            }
        }

        const nutritionHeaders = [
            'Data', 'Peso (kg)', 'Kcal', 'Carbo (g)', 'Pro (g)', 'Grassi (g)', 'BF (%)', 'Fonte BF',
            'Collo (cm)', 'Torace (cm)', 'Spalle (cm)', 'Braccia (cm)', 'Vita (cm)', 'Fianchi (cm)',
            'Cosce (cm)', 'Polpacci (cm)', 'Ore sonno', 'Sonno profondo', 'Sonno leggero', 'Sonno REM', 'Tempo sveglio',
            'Ora misurazione', 'Giorno ON', 'Pasti', 'Integratori assunti', 'Input Body Fat',
        ];
        let nutritionCsv = nutritionHeaders.join(',') + '\n';
        const nutritionDates = Object.keys(nutrition).sort();
        for (const date of nutritionDates) {
            const day = nutrition[date];
            nutritionCsv += this.formatCsvRow([
                date,
                day.weight ?? '',
                day.kcal,
                day.carbs,
                day.pro,
                day.fat,
                day.bf ?? '',
                day.bfProvenance?.method ?? '',
                day.neck ?? '',
                day.chest ?? '',
                day.shoulders ?? '',
                day.biceps ?? '',
                day.waist ?? '',
                day.hip ?? '',
                day.thighs ?? '',
                day.calves ?? '',
                Logic.formatSleepTime(day.sleepHours),
                Logic.formatSleepTime(day.sleepDeep),
                Logic.formatSleepTime(day.sleepLight),
                Logic.formatSleepTime(day.sleepRem),
                Logic.formatSleepTime(day.sleepAwake),
                day.measurementTime ?? '',
                day.isDayOn ?? '',
                jsonCell(day.meals ?? []),
                jsonCell(day.supplementsIntake ?? []),
                jsonCell(day.bfProvenance?.inputs),
            ]);
        }

        let stepsCsv = "Data,Passi,Fonte,Rilevato il\n";
        let cardioCsv = "Data,ID,Ora inizio,Modalità,Struttura,Durata (min),Intensità,FC media (bpm),Distanza (km),Note,Fonte,ID esterno\n";
        let stepsRows = 0;
        let cardioRows = 0;
        for (const date of nutritionDates) {
            const day = nutrition[date];
            if (typeof day.steps === 'number' && Number.isFinite(day.steps) && day.steps >= 0) {
                stepsCsv += this.formatCsvRow([date, day.steps, day.stepsSource ?? '', isoInstant(day.stepsCapturedAt)]);
                stepsRows++;
            }
            day.cardioSessions?.forEach(session => {
                cardioCsv += this.formatCsvRow([
                    date, session.id, isoInstant(session.startedAt), session.modality, session.structure ?? '',
                    session.durationMinutes, session.intensity ?? '', session.averageHeartRate ?? '',
                    session.distanceKm ?? '', session.notes ?? '', session.source ?? '', session.externalId ?? '',
                ]);
                cardioRows++;
            });
        }

        const outputs: Array<[string, string]> = [];
        if (history.length) outputs.push(['allenamenti.csv', workoutCsv]);
        else await useDialogStore.getState().showAlert('Nessun allenamento da esportare.');
        if (nutritionDates.length) outputs.push(['misurazioni.csv', nutritionCsv]);
        if (stepsRows) outputs.push(['passi.csv', stepsCsv]);
        if (cardioRows) outputs.push(['cardio.csv', cardioCsv]);

        for (const [filename, content] of outputs) {
            const saved = await this.downloadFile(filename, content, 'text/csv;charset=utf-8;');
            if (!saved) return false;
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
        const base = createBackup(userData, null, { scope: 'device', months: [] });
        const payload = {
            ...base,
            type: 'share' as const,
            owner: null,
            userData: shareData,
            recovery: undefined,
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
        saveUserData: (
            update: (previous: UserData | null) => UserData,
            options?: { expectedRevision?: number },
        ) => Promise<unknown>,
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
                '\nI consensi importati non verranno applicati.\nProcedere?';
            if (!(await useDialogStore.getState().showConfirm(summary, 'Anteprima importazione'))) return;
            assertCurrent();
            const latestEnvelope = await readLocal(session.owner);
            assertCurrent();
            if (!latestEnvelope || latestEnvelope.revision !== expectedRevision) {
                throw new Error('I dati sono cambiati durante l’anteprima. Ripeti l’importazione.');
            }
            await saveUserData(previous => {
                assertCurrent();
                if (!equal(previous, snapshot)) throw new Error('I dati sono cambiati durante l’anteprima. Ripeti l’importazione.');
                return prepared.data;
            }, { expectedRevision });
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
