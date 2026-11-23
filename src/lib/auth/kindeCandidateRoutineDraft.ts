import equal from 'fast-deep-equal';
import { accountRoutineDraftSchema } from '../routineRecoverySchema';
import { buildRoutineSaveOperations } from '../routineSaveIntent';
import { openKindeCatalogDraft, type KindeCatalogDraftController } from './kindeCandidateCatalogDraft';
import { generateId } from '../utils/date';
import { normalizeBusinessId } from '../businessIdentity';
import type { RoutineExercise, WorkoutRoutine } from '../../types';

const KEY = 'draft_routine';
type Values = { name: string; exercises: RoutineExercise[] };
type KindeRoutineDraftValues = Values & {
    version: 1;
    routineId: string;
    basis: Values | null;
    submitted: boolean;
};

export type KindeRoutineDraft = {
    initial: Values & { routineId: string; editing: boolean; submitted: boolean };
    write: (values: Values) => void;
    discard: () => void;
    close: () => void;
};

const routineValues = ({ name, exercises }: WorkoutRoutine): Values => ({ name, exercises });
const persistedValues = (value: Values): Values => JSON.parse(JSON.stringify(value)) as Values;

export async function openKindeCandidateRoutineDraft({ owner, revision, permitted, routine }: {
    owner: string;
    revision: number;
    permitted: () => boolean;
    routine?: WorkoutRoutine;
}): Promise<KindeCatalogDraftController<KindeRoutineDraft>> {
    const device = await openKindeCatalogDraft<KindeRoutineDraftValues>({
        owner, key: KEY, revision, permitted, parse: value => accountRoutineDraftSchema.parse(value),
        initialize: () => {
            const basis = routine ? persistedValues(routineValues(routine)) : null;
            return { version: 1, routineId: routine?.id ?? generateId('rtn'), basis, submitted: false,
                name: basis?.name ?? '', exercises: basis?.exercises ?? [] };
        },
    });
    try {
        const draft = device.current();
        if (routine && (draft.routineId !== routine.id || !draft.basis)) {
            throw new Error('Riprendi la bozza in corso prima di aprire un’altra scheda.');
        }

        const handle: KindeRoutineDraft = {
            initial: {
                name: draft.name, exercises: structuredClone(draft.exercises),
                routineId: draft.routineId, editing: draft.basis !== null, submitted: draft.submitted,
            },
            discard: device.discard, close: device.close,
            write: values => device.persist({ ...device.editable(), name: values.name, exercises: values.exercises }),
        };

        return {
            handle,
            prepare: ({ routines = [] }) => {
                const submitted = device.editable();
                const operation = buildRoutineSaveOperations({
                    name: submitted.name, exercises: submitted.exercises, routines,
                    editingRoutineId: submitted.basis ? submitted.routineId : null,
                    createId: submitted.routineId,
                });
                const originalExercises = new Set(submitted.basis?.exercises.map(exercise => exercise.exId));
                const addedExercises = submitted.exercises.map(exercise => normalizeBusinessId(exercise.exId))
                    .filter(id => !originalExercises.has(id ?? ''));
                return device.prepareCommit(submitted, operation, envelope => {
                    const current = envelope.data.routines?.find(routine => routine.id === submitted.routineId);
                    if (submitted.basis ? !current || !equal(persistedValues(routineValues(current)), submitted.basis) : current) {
                        throw new Error('Scheda cambiata nel frattempo. La bozza è stata conservata.');
                    }
                    const library = new Set(envelope.data.library?.map(exercise => exercise.id));
                    if (addedExercises.some(id => id === null || !library.has(id))) {
                        throw new Error('Un esercizio aggiunto è stato rimosso. La bozza è stata conservata.');
                    }
                });
            },
        };
    } catch (error) {
        device.close();
        throw error;
    }
}
