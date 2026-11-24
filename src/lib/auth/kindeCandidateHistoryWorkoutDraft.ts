import {
    parseOptionalWaterLiters, prepareHistoricalWorkoutForEditing, prepareHistoricalWorkoutForSave,
} from '../../hooks/workout/workoutSessionPreparation';
import type { UserData, WorkoutSession } from '../../types';
import { requireDate, requireId } from '../sync/domainOperations/validation';
import { requiredUpdateRecoveryRegistry } from '../sync/requiredUpdateRecovery';
import { equivalentWorkoutSnapshot } from '../sync/workoutSnapshotEquality';
import { draftRegistry } from '../utils/draftRegistry';
import { parseManualDuration } from '../utils/duration';
import { z } from '../zod';
import { openKindeCatalogDraft, type KindeCatalogDraftController } from './kindeCandidateCatalogDraft';
import { parseKindeWorkoutSnapshot } from './kindeCandidateWorkoutSnapshot';

const workoutSchema = z.unknown().transform((value): WorkoutSession => parseKindeWorkoutSnapshot(value));
const ratingsSchema = z.object({ mood: z.string(), pump: z.string(), fatigue: z.string(), water: z.string() }).strict();
const editSchema = z.object({ workout: workoutSchema, ratings: ratingsSchema }).strict();
const draftSchema = z.object({
    version: z.literal(1),
    submitted: z.boolean(),
    expected: workoutSchema,
    edit: editSchema,
}).strict().superRefine(({ expected, edit: { workout } }, context) => {
    if (expected.isEditingHistory || expected.originalHistoryId || !workout.isEditingHistory
        || workout.id !== expected.id || workout.originalHistoryId !== expected.id || workout.date !== expected.date
        || workout.globalStartTime !== expected.globalStartTime || workout.globalEndTime !== expected.globalEndTime) {
        context.addIssue({ code: 'custom', message: 'La copia appartiene a un’altra seduta dello storico.' });
    }
});

export type KindeHistoryWorkoutEdit = z.infer<typeof editSchema>;

export type KindeHistoryWorkoutDraft = {
    initial: KindeHistoryWorkoutEdit & { stale: boolean; submitted: boolean };
    write: (edit: KindeHistoryWorkoutEdit) => void;
    discard: () => void;
    close: () => void;
};

export async function openKindeCandidateHistoryWorkoutDraft({
    owner, revision, permitted, history, workoutId,
}: {
    owner: string;
    revision: number;
    permitted: () => boolean;
    history: UserData['history'];
    workoutId?: string;
}): Promise<KindeCatalogDraftController<KindeHistoryWorkoutDraft>> {
    const device = await openKindeCatalogDraft({
        owner, revision, permitted, key: 'draft:history-workout',
        parse: value => draftSchema.parse(value),
        initialize: () => {
            const source = workoutId && history?.find(workout => workout.id === workoutId);
            if (!source) throw new Error('Nessuna seduta dello storico da modificare.');
            return draftSchema.parse({
                version: 1, submitted: false, expected: source,
                edit: {
                    workout: prepareHistoricalWorkoutForEditing(source),
                    ratings: {
                        mood: String(source.moodRating ?? ''), pump: String(source.pumpRating ?? ''),
                        fatigue: String(source.fatigueRating ?? ''), water: String(source.waterLiters ?? ''),
                    },
                },
            });
        },
    });
    try {
        const observed = device.current();
        if (workoutId !== undefined && observed.expected.id !== workoutId) {
            throw new Error('Riprendi prima la bozza dello storico già presente.');
        }
        const source = history?.find(workout => workout.id === observed.expected.id);
        const stale = !equivalentWorkoutSnapshot(source, observed.expected);
        const editable = () => {
            if (stale) throw new Error('La seduta originale è cambiata. Copia sul dispositivo conservata.');
            return device.editable();
        };
        const verify = () => { device.current(); };
        draftRegistry.register(verify);
        const unregisterRecovery = requiredUpdateRecoveryRegistry.register(verify);
        const close = () => {
            draftRegistry.unregister(verify);
            unregisterRecovery();
            device.close();
        };
        const discard = () => { device.discard(); close(); };
        return {
            handle: {
                initial: { ...structuredClone(observed.edit), stale, submitted: observed.submitted },
                write: edit => device.persist({ ...editable(), edit }),
                discard,
                close,
            },
            prepare: () => {
                const draft = editable();
                const { workout, ratings } = draft.edit;
                const duration = parseManualDuration(workout.manualDurationStr || workout.globalDurationStr || '00:00:00');
                if (duration === null) throw new Error('Durata non valida. Usa il formato ore:minuti:secondi.');
                if (ratings.water.trim() && parseOptionalWaterLiters(ratings.water) === undefined) {
                    throw new Error('Quantità di acqua non valida.');
                }
                const id = requireId(draft.expected.id, 'Seduta nello storico');
                const edited = prepareHistoricalWorkoutForSave(workout, id, ratings, ratings.water, duration);
                requireDate(edited.date ?? '');
                const prepared = device.prepareCommit(draft, { type: 'history.upsert', workout: edited }, envelope => {
                    const latest = envelope.data.history?.find(workout => workout.id === draft.expected.id);
                    if (!equivalentWorkoutSnapshot(latest, draft.expected)) {
                        throw new Error('La seduta originale è cambiata. Copia sul dispositivo conservata.');
                    }
                });
                return { ...prepared, clearAfterCommit: discard };
            },
        };
    } catch (error) {
        device.close();
        throw error;
    }
}
