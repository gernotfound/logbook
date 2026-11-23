import equal from 'fast-deep-equal';
import { accountRoutineDraftSchema } from '../routineRecoverySchema';
import { buildRoutineSaveOperations } from '../routineSaveIntent';
import { openScopedDeviceRecord } from '../sync/scopedDeviceRecord';
import { decodeWorkoutRecoveryDraft, encodeAccountWorkoutRecoveryDraft } from '../sync/workoutRecoveryDraftRecord';
import { generateId } from '../utils/date';
import { normalizeBusinessId } from '../businessIdentity';
import type { RoutineExercise, WorkoutRoutine } from '../../types';
import type { LocalEnvelope } from '../sync/localEnvelopeValidation';

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
}) {
    if (!owner.startsWith('user:') || !Number.isSafeInteger(revision) || revision < 1) throw new Error('Consenso della bozza non verificabile.');
    const device = await openScopedDeviceRecord(owner, KEY, permitted);
    try {
        const initial = device.read();
        let raw = initial.raw;
        let draft: KindeRoutineDraftValues;
        if (initial.plaintext !== null) {
            const decoded = decodeWorkoutRecoveryDraft(initial.plaintext, KEY, owner);
            if (decoded.revision !== revision) throw new Error('Bozza di un consenso precedente. Copia conservata.');
            draft = accountRoutineDraftSchema.parse(decoded.value);
            if (routine && (draft.routineId !== routine.id || !draft.basis)) {
                throw new Error('Riprendi la bozza in corso prima di aprire un’altra scheda.');
            }
        } else {
            const basis = routine ? persistedValues(routineValues(routine)) : null;
            draft = { version: 1, routineId: routine?.id ?? generateId('rtn'), basis, submitted: false,
                name: basis?.name ?? '', exercises: basis?.exercises ?? [] };
        }
        const assertCurrent = () => {
            if (device.read().raw !== raw) throw new Error('Bozza cambiata: copia più recente conservata.');
        };
        const persist = (next: KindeRoutineDraftValues) => {
            const validated = accountRoutineDraftSchema.parse(next);
            raw = device.replace(raw, encodeAccountWorkoutRecoveryDraft(KEY, owner, revision, validated));
            draft = validated;
        };
        const discard = () => {
            raw = device.replace(raw, null);
            device.close();
        };

        const handle: KindeRoutineDraft = {
            initial: {
                name: draft.name, exercises: structuredClone(draft.exercises),
                routineId: draft.routineId, editing: draft.basis !== null, submitted: draft.submitted,
            },
            discard, close: device.close,
            write: values => {
                assertCurrent();
                if (draft.submitted) throw new Error('Salvataggio già tentato. Verifica l’archivio prima di rimuovere la bozza.');
                persist({ ...draft, name: values.name, exercises: values.exercises });
            },
        };

        return {
            handle,
            prepare: (routines: readonly WorkoutRoutine[]) => {
                assertCurrent();
                const submitted = draft;
                if (submitted.submitted) throw new Error('Salvataggio già tentato. Verifica l’archivio.');
                const operation = buildRoutineSaveOperations({
                    name: submitted.name, exercises: submitted.exercises, routines,
                    editingRoutineId: submitted.basis ? submitted.routineId : null,
                    createId: submitted.routineId,
                });
                const originalExercises = new Set(submitted.basis?.exercises.map(exercise => exercise.exId));
                const addedExercises = submitted.exercises.map(exercise => normalizeBusinessId(exercise.exId))
                    .filter(id => !originalExercises.has(id ?? ''));
                const beforeCommit = (envelope: LocalEnvelope | undefined) => {
                    assertCurrent();
                    if (draft !== submitted || envelope?.consentRevision !== revision || envelope.owner !== owner) return false;
                    const current = envelope.data.routines?.find(routine => routine.id === submitted.routineId);
                    if (submitted.basis ? !current || !equal(persistedValues(routineValues(current)), submitted.basis) : current) {
                        throw new Error('Scheda cambiata nel frattempo. La bozza è stata conservata.');
                    }
                    const library = new Set(envelope.data.library?.map(exercise => exercise.id));
                    if (addedExercises.some(id => id === null || !library.has(id))) {
                        throw new Error('Un esercizio aggiunto è stato rimosso. La bozza è stata conservata.');
                    }
                    // If the browser stops before it can verify durability, this
                    // attempt can be inspected or discarded but never sent again.
                    persist({ ...submitted, submitted: true });
                    return true;
                };
                return { operation, beforeCommit, clearAfterCommit: discard };
            },
        };
    } catch (error) {
        device.close();
        throw error;
    }
}
