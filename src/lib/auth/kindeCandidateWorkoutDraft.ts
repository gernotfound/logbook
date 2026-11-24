import equal from 'fast-deep-equal';
import {
    applyWorkoutCompletionDraft, buildFreeWorkout, buildRoutineWorkout, prepareCompletedWorkout,
    type WorkoutCompletionDraft,
} from '../../hooks/workout/workoutSessionPreparation';
import type { UserData, WorkoutReadiness, WorkoutSession } from '../../types';
import { DomainParsers } from '../schema';
import { Logic } from '../logic';
import type { DomainOperation } from '../sync/domainOperations';
import { assertWorkoutSessionIdentities, requireDate } from '../sync/domainOperations/validation';
import { requiredUpdateRecoveryRegistry } from '../sync/requiredUpdateRecovery';
import { equivalentWorkoutSnapshot } from '../sync/workoutSnapshotEquality';
import { draftRegistry } from '../utils/draftRegistry';
import { z } from '../zod';
import { openKindeCatalogDraft, type KindeCatalogDraftController } from './kindeCandidateCatalogDraft';

export type KindeWorkoutOrigin = { kind: 'free' } | { kind: 'routine'; routineId: string };
export type KindeWorkoutClosure = { kind: 'complete'; endedAt: number } | { kind: 'delete' };
export type KindeWorkoutEdit = {
    workout: WorkoutSession;
    readiness: Omit<WorkoutReadiness, 'capturedAt'>;
    review: { endedAt: number | null; values: WorkoutCompletionDraft } | null;
};

const readinessRating = z.number().int().min(1).max(5).optional();
const readinessSchema = z.object({
    energy: readinessRating,
    stress: readinessRating,
    motivation: readinessRating,
    muscleRecovery: readinessRating,
}).strict();
const reviewSchema = z.object({
    endedAt: z.number().int().positive().nullable(),
    values: z.object({
        mood: z.string(), pump: z.string(), fatigue: z.string(), water: z.string(), pains: z.array(z.string()),
    }).strict(),
}).strict().nullable();

const workoutSchema = z.unknown().transform((value): WorkoutSession => {
    const parsed = DomainParsers.parseActiveWorkout(value);
    if (!parsed?.id || parsed.isEditingHistory || parsed.originalHistoryId || parsed.globalEndTime !== undefined) {
        throw new Error('Seduta attiva non valida.');
    }
    requireDate(parsed.date ?? '');
    assertWorkoutSessionIdentities(parsed, 'Bozza seduta');
    const stored = JSON.parse(JSON.stringify(value)) as WorkoutSession;
    const canonical = JSON.parse(JSON.stringify(parsed)) as WorkoutSession;
    // The persisted schema is also a reader with fallbacks. An edit must
    // never use those fallbacks to replace values from a damaged draft.
    if (!equal({ pains: [], ...stored }, canonical)) throw new Error('Copia della seduta non verificabile.');
    return parsed;
});

const draftSchema = z.object({
    version: z.literal(1),
    submitted: z.boolean(),
    closing: z.boolean(),
    expectedCloud: workoutSchema.nullable(),
    workout: workoutSchema,
    readiness: readinessSchema,
    review: reviewSchema,
}).strict().superRefine(({ expectedCloud, workout, closing, submitted, review }, context) => {
    if (expectedCloud !== null && expectedCloud.id !== workout.id) {
        context.addIssue({ code: 'custom', message: 'La bozza appartiene a un’altra seduta.' });
    }
    if ((closing && !submitted) || (review?.endedAt && (!workout.globalStartTime || review.endedAt < workout.globalStartTime))) {
        context.addIssue({ code: 'custom', message: 'La sequenza della seduta non è verificabile.' });
    }
});

export type KindeWorkoutDraft = {
    initial: KindeWorkoutEdit & { stale: boolean; submitted: boolean };
    write: (edit: KindeWorkoutEdit) => void;
    discard: () => void;
    close: () => void;
};

type WorkoutDraftController = KindeCatalogDraftController<KindeWorkoutDraft>;

function prepareClosure({ workout, review }: KindeWorkoutEdit, closure: KindeWorkoutClosure, activePains: string[]): DomainOperation {
    const id = workout.id;
    if (!id) throw new Error('Seduta da chiudere non identificabile.');
    if (closure.kind === 'delete') return { type: 'active-workout.set', workout: null, deletedWorkoutId: id };
    if (!Number.isSafeInteger(closure.endedAt) || !workout.globalStartTime || closure.endedAt < workout.globalStartTime) {
        throw new Error('Non è possibile salvare la durata della seduta.');
    }
    if (review && review.endedAt !== closure.endedAt) throw new Error('La revisione della seduta è cambiata.');
    const reviewed = review ? applyWorkoutCompletionDraft(workout, review.values) : workout;
    const { finishedWorkout, sessionPains } = prepareCompletedWorkout(reviewed, closure.endedAt);
    return {
        type: 'workout.complete', workout: finishedWorkout, expectedActiveWorkoutId: id,
        activePains: Logic.mergeActivePains(activePains, sessionPains),
    };
}

export async function openKindeCandidateWorkoutDraft({
    owner, revision, permitted, data, origin,
}: {
    owner: string;
    revision: number;
    permitted: () => boolean;
    data: UserData;
    origin?: KindeWorkoutOrigin;
}): Promise<WorkoutDraftController & {
    prepare: (data: UserData, closure?: KindeWorkoutClosure) => ReturnType<WorkoutDraftController['prepare']>;
}> {
    const cloud = data.activeWorkout ?? null;
    const device = await openKindeCatalogDraft({
        owner, revision, permitted, key: 'draft:active-workout',
        parse: value => draftSchema.parse(value),
        initialize: () => {
            if (origin && cloud) throw new Error('Una seduta è già in corso.');
            const routine = origin?.kind === 'routine' ? data.routines?.find(item => item.id === origin.routineId) : undefined;
            if (origin?.kind === 'routine' && !routine) throw new Error('Scheda non disponibile.');
            const workout = routine ? buildRoutineWorkout(data, routine) : origin ? buildFreeWorkout() : cloud;
            if (!workout) throw new Error('Nessuna seduta da riprendere.');
            return draftSchema.parse({
                version: 1, submitted: false, closing: false, expectedCloud: cloud, workout, readiness: {}, review: null,
            });
        },
    });
    try {
        let observed = device.current();
        if (observed.submitted && !observed.closing && equivalentWorkoutSnapshot(cloud, observed.workout)) {
            // The exact device image is present in the verified archive.
            // Retain it independently: a later cloud refresh must not replace it.
            observed = { ...observed, expectedCloud: cloud, submitted: false };
            device.persist(observed);
        }
        // Starting an activity cannot silently reuse a draft from another
        // routine or discard a prepared session from an earlier visit.
        if (origin && (observed.expectedCloud || observed.submitted
            || (origin.kind === 'routine' ? observed.workout.routineId !== origin.routineId : observed.workout.routineId))) {
            throw new Error('Riprendi prima la seduta già preparata.');
        }
        const stale = !equivalentWorkoutSnapshot(cloud, observed.expectedCloud);
        const editable = () => {
            if (stale) throw new Error('La seduta condivisa è cambiata. Copia sul dispositivo conservata.');
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
                initial: {
                    ...structuredClone({ workout: observed.workout, readiness: observed.readiness, review: observed.review }),
                    stale, submitted: observed.submitted,
                },
                write: ({ workout, readiness, review }) => {
                    const current = editable();
                    if (workout.id !== current.workout.id) throw new Error('La seduta è cambiata.');
                    device.persist({ ...current, workout, readiness, review });
                },
                discard,
                close,
            },
            prepare: (latest: UserData, closure?: KindeWorkoutClosure) => {
                const submitted = editable();
                const lastPains = latest.activePains ?? [];
                const operation = closure
                    ? prepareClosure(submitted, closure, lastPains)
                    : { type: 'active-workout.set' as const, workout: submitted.workout };
                const prepared = device.prepareCommit(submitted, operation, envelope => {
                    if (!equivalentWorkoutSnapshot(envelope.data.activeWorkout, submitted.expectedCloud)) {
                        throw new Error('La seduta condivisa è cambiata. Copia sul dispositivo conservata.');
                    }
                    if (closure?.kind === 'complete' && !equal(envelope.data.activePains ?? [], lastPains)) {
                        throw new Error('Le informazioni della seduta sono cambiate. Copia sul dispositivo conservata.');
                    }
                }, closure ? { closing: true } : undefined);
                return { operation: prepared.operation, beforeCommit: prepared.beforeCommit,
                    ...(closure ? { clearAfterCommit: discard } : {}) };
            },
        };
    } catch (error) {
        device.close();
        throw error;
    }
}
