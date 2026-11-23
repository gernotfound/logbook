import equal from 'fast-deep-equal';
import type { Exercise } from '../../types';
import { normalizeBusinessId } from '../businessIdentity';
import { MUSCLES } from '../constants/muscles';
import { exerciseDraftSchema, type ExerciseDraft } from '../exerciseEditorDraft';
import { buildExerciseEditorFields, exerciseDraftProblem, hasDuplicateExerciseName } from '../exerciseEditorModel';
import type { DomainOperation } from '../sync/domainOperations';
import { generateId } from '../utils/date';
import { z } from '../zod';
import { openKindeCatalogDraft, type KindeCatalogDraftController } from './kindeCandidateCatalogDraft';

const accountExerciseDraftSchema = z.object({
    version: z.literal(1),
    id: z.string().refine(id => normalizeBusinessId(id) === id),
    basis: exerciseDraftSchema.nullable(),
    values: exerciseDraftSchema,
    submitted: z.boolean(),
}).strict();

type AccountExerciseDraft = {
    version: 1;
    id: string;
    basis: ExerciseDraft | null;
    values: ExerciseDraft;
    submitted: boolean;
};

export type KindeExerciseDraft = {
    initial: { values: ExerciseDraft; editingId: string | null; submitted: boolean };
    write: (values: ExerciseDraft) => void;
    discard: () => void;
    close: () => void;
};

const toMuscles = (ids: readonly string[] = []) => ids.map(id => MUSCLES.find(muscle => muscle.id === id) ?? { id, name: id });
const toDraft = (exercise?: Exercise): ExerciseDraft => ({
    name: exercise?.name ?? '',
    notes: exercise?.notes ?? '',
    trackingType: exercise?.trackingType ?? 'weight_reps',
    selectedMuscles: toMuscles(exercise?.muscles),
    secondaryMuscles: toMuscles(exercise?.secondaryMuscles),
    isBodyweight: exercise?.isBodyweight ?? false,
    equipmentWeight: exercise?.equipmentWeight == null ? '' : String(exercise.equipmentWeight),
});
const comparableDraft = ({ selectedMuscles, secondaryMuscles, ...fields }: ExerciseDraft) => ({
    ...fields,
    selectedMuscles: selectedMuscles.map(muscle => muscle.id),
    secondaryMuscles: secondaryMuscles.map(muscle => muscle.id),
});

export async function openKindeCandidateExerciseDraft({ owner, revision, permitted, exercise }: {
    owner: string;
    revision: number;
    permitted: () => boolean;
    exercise?: Exercise;
}): Promise<KindeCatalogDraftController<KindeExerciseDraft>> {
    const device = await openKindeCatalogDraft<AccountExerciseDraft>({
        owner, key: 'draft_exercise', revision, permitted, parse: value => accountExerciseDraftSchema.parse(value),
        initialize: () => ({
            version: 1, id: exercise?.id ?? generateId('ex'),
            basis: exercise ? toDraft(exercise) : null, values: toDraft(exercise), submitted: false,
        }),
    });
    try {
        const draft = device.current();
        if (exercise && (draft.id !== exercise.id || !draft.basis)) {
            throw new Error('Riprendi la bozza in corso prima di aprire un altro esercizio.');
        }

        return {
            handle: {
                initial: { values: structuredClone(draft.values), editingId: draft.basis ? draft.id : null, submitted: draft.submitted },
                write: values => device.persist({ ...device.editable(), values }),
                discard: device.discard, close: device.close,
            },
            prepare: ({ library = [] }) => {
                const submitted = device.editable();
                const fields = buildExerciseEditorFields(submitted.values);
                const editingId = submitted.basis ? submitted.id : null;
                const problem = exerciseDraftProblem(library, editingId, submitted.values);
                if (problem) throw new Error(problem);
                const operation: DomainOperation = editingId
                    ? { type: 'exercise.edit', id: editingId, fields }
                    : { type: 'exercise.upsert', exercise: { ...fields, id: submitted.id, setsCount: 3, sets: [] } };
                return device.prepareCommit(submitted, operation, ({ data }) => {
                    const currentLibrary = data.library ?? [];
                    if (hasDuplicateExerciseName(currentLibrary, editingId, fields.name)) {
                        throw new Error('Nome esercizio già presente. La bozza è stata conservata.');
                    }
                    const existing = currentLibrary.find(item => item.id === submitted.id);
                    const basisMatches = submitted.basis
                        ? existing && !existing.isDefault && equal(comparableDraft(toDraft(existing)), comparableDraft(submitted.basis))
                        : !existing;
                    if (!basisMatches) {
                        throw new Error('Esercizio cambiato nel frattempo. La bozza è stata conservata.');
                    }
                });
            },
        };
    } catch (error) {
        device.close();
        throw error;
    }
}
