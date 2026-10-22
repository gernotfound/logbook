import { Logic } from './logic';
import { requireCanonicalWorkoutDate } from './sync/monthlyIntegrity';
import type { Exercise, NutritionDay, SessionExercise, SessionExerciseSet, WorkoutSession } from '../types';

// Pure CSV serialization; formatCsvField preserves the spreadsheet formula
// neutralization contract. BOM insertion belongs to the device download step.
export function formatCsvField(value: unknown): string {
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
}

export function formatCsvRow(fields: Array<string | number | boolean | null | undefined>): string {
    return fields.map(field => formatCsvField(field)).join(",") + "\n";
}

/**
 * Materialize the analytical CSV files in download order without accessing
 * browser APIs or modifying the source records. This is not a backup format.
 */
export function buildCsvFiles(
    history: WorkoutSession[],
    nutrition: Record<string, NutritionDay>,
    library: Array<Pick<Exercise, 'id' | 'name'>> = [],
): Array<[string, string]> {
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
        const workoutRows = [workoutHeaders.join(',') + '\n'];

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
            workoutRows.push(formatCsvRow([
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
            ]));
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
        const nutritionRows = [nutritionHeaders.join(',') + '\n'];
        const nutritionDates = Object.keys(nutrition).sort();
        for (const date of nutritionDates) {
            const day = nutrition[date];
            nutritionRows.push(formatCsvRow([
                date,
                day.weight,
                day.kcal,
                day.carbs,
                day.pro,
                day.fat,
                day.bf,
                day.bfProvenance?.method ?? '',
                day.neck,
                day.chest,
                day.shoulders,
                day.biceps,
                day.waist,
                day.hip,
                day.thighs,
                day.calves,
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
            ]));
        }

        const stepsRowsContent = ["Data,Passi,Fonte,Rilevato il\n"];
        const cardioRowsContent = ["Data,ID,Ora inizio,Modalità,Struttura,Durata (min),Intensità,FC media (bpm),Distanza (km),Note,Fonte,ID esterno\n"];
        let stepsRows = 0;
        let cardioRows = 0;
        for (const date of nutritionDates) {
            const day = nutrition[date];
            if (typeof day.steps === 'number' && Number.isFinite(day.steps) && day.steps >= 0) {
                stepsRowsContent.push(formatCsvRow([date, day.steps, day.stepsSource ?? '', isoInstant(day.stepsCapturedAt)]));
                stepsRows++;
            }
            day.cardioSessions?.forEach(session => {
                cardioRowsContent.push(formatCsvRow([
                    date, session.id, isoInstant(session.startedAt), session.modality, session.structure ?? '',
                    session.durationMinutes, session.intensity ?? '', session.averageHeartRate ?? '',
                    session.distanceKm ?? '', session.notes ?? '', session.source ?? '', session.externalId ?? '',
                ]));
                cardioRows++;
            });
        }


        const outputs: Array<[string, string]> = [];
        if (history.length) outputs.push(['allenamenti.csv', workoutRows.join('')]);
        if (nutritionDates.length) outputs.push(['misurazioni.csv', nutritionRows.join('')]);
        if (stepsRows) outputs.push(['passi.csv', stepsRowsContent.join('')]);
        if (cardioRows) outputs.push(['cardio.csv', cardioRowsContent.join('')]);
        return outputs;
}
