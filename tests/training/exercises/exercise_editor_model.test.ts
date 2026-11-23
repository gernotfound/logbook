import { describe, expect, it } from 'vitest';
import { Logic } from '../../../src/lib/logic';
import type { MuscleDef } from '../../../src/lib/constants/muscles';
import type { Exercise } from '../../../src/types';
import {
    removeExerciseMuscle,
    resolveExerciseMuscles,
    toggleExerciseMuscle,
} from '../../../src/hooks/trainingExercises/exerciseMuscleEditor';
import {
    buildExerciseSavePayload,
    exerciseDraftProblem,
    hasDuplicateExerciseName,
} from '../../../src/lib/exerciseEditorModel';
import type { ExerciseDraft } from '../../../src/hooks/trainingExercises/exerciseDraft';

function muscle(id: string): MuscleDef {
    const found = Logic.MUSCLES.find(item => item.id === id);
    if (!found) throw new Error(`Muscolo di prova mancante: ${id}`);
    return found;
}

const draft: ExerciseDraft = {
    name: '  Panca inclinata  ',
    notes: '  Esegui con controllo  ',
    trackingType: 'weight_reps',
    selectedMuscles: [muscle('chest')],
    secondaryMuscles: [muscle('triceps')],
    isBodyweight: false,
    equipmentWeight: '12,5',
};

const original: Exercise = {
    id: 'bench',
    name: 'Panca',
    notes: 'Prima',
    setsCount: 4,
    sets: [{ weight: '30', reps: '8', done: false }],
    muscles: ['chest_upper'],
    isDefault: true,
};

describe('exercise editor muscle selection', () => {
    it('moves only the selected side out of the opposing bilateral group', () => {
        const originalSecondary = [muscle('biceps')];
        const result = toggleExerciseMuscle([], originalSecondary, 'primary', muscle('biceps_left'));
        expect(result.selectedMuscles.map(item => item.id)).toEqual(['biceps_left']);
        expect(result.secondaryMuscles.map(item => item.id)).toEqual(['biceps_right']);
        expect(originalSecondary.map(item => item.id)).toEqual(['biceps']);
    });

    it('moves an entire base group from primary to secondary without keeping conflicting sides', () => {
        const result = toggleExerciseMuscle(
            [muscle('biceps_left'), muscle('biceps_right')],
            [],
            'secondary',
            muscle('biceps'),
        );
        expect(result.selectedMuscles).toEqual([]);
        expect(result.secondaryMuscles.map(item => item.id)).toEqual(['biceps']);
    });

    it('removes a single side and preserves the other when an entire group was selected', () => {
        const result = removeExerciseMuscle([muscle('biceps')], muscle('biceps_left'));
        expect(result.map(item => item.id)).toEqual(['biceps_right']);
    });

    it('does not mutate selections when toggled input is missing', () => {
        const selected = [muscle('chest')];
        const secondary = [muscle('lats')];
        const result = toggleExerciseMuscle(selected, secondary, 'primary', null as unknown as MuscleDef);
        expect(result.selectedMuscles).toBe(selected);
        expect(result.secondaryMuscles).toBe(secondary);
    });

    it('rehydrates recognized muscle IDs in order and ignores unavailable ones', () => {
        expect(resolveExerciseMuscles(['biceps_right', 'unknown', 'biceps_left', 'biceps_right'])
            .map(item => item.id)).toEqual(['biceps_right', 'biceps_left', 'biceps_right']);
        expect(resolveExerciseMuscles(undefined)).toEqual([]);
    });
});

describe('exercise editor save payload', () => {
    it('accepts existing decimal weights and rejects malformed weights without silently clearing them', () => {
        for (const value of ['', '0', '12,5', '.5', '1e-7']) {
            expect(exerciseDraftProblem([], null, { ...draft, equipmentWeight: value })).toBeNull();
        }
        for (const value of ['12kg', '-2', 'Infinity', '0x2']) {
            expect(exerciseDraftProblem([], null, { ...draft, equipmentWeight: value })).toContain('peso attrezzo');
        }
    });

    it('preserves the stored fields of an existing exercise while changing only editable fields', () => {
        const generated = () => { throw new Error('Editing must not create an identity'); };
        const updated = buildExerciseSavePayload([original], original.id, draft, generated);
        expect(updated).toEqual({
            ...original,
            name: 'Panca inclinata',
            notes: 'Esegui con controllo',
            muscles: ['chest'],
            secondaryMuscles: ['triceps'],
            trackingType: 'weight_reps',
            isBodyweight: undefined,
            equipmentWeight: 12.5,
        });
        expect(original).toEqual(expect.objectContaining({ name: 'Panca', notes: 'Prima', isDefault: true }));
    });

    it('creates a new exercise with initialized sets and a unique generated ID', () => {
        const created = buildExerciseSavePayload([original], null, draft, () => 'new-bench');
        expect(created).toEqual(expect.objectContaining({
            id: 'new-bench', name: 'Panca inclinata', notes: 'Esegui con controllo',
            setsCount: 3, sets: [], muscles: ['chest'], equipmentWeight: 12.5,
        }));
        expect(created?.isDefault).toBeUndefined();
    });

    it('fails without choosing an unrelated item for missing edit IDs or generated collisions', () => {
        expect(buildExerciseSavePayload([original], 'missing', draft, () => 'unused')).toBeUndefined();
        expect(buildExerciseSavePayload([original], null, draft, () => 'bench')).toBeUndefined();
    });

    it('checks duplicate names case-insensitively, excluding only the edited exercise ID', () => {
        expect(hasDuplicateExerciseName([original], null, ' pANCA ')).toBe(true);
        expect(hasDuplicateExerciseName([original], 'bench', ' pANCA ')).toBe(false);
        expect(hasDuplicateExerciseName([original], 'different', 'Panca')).toBe(true);
        expect(hasDuplicateExerciseName([original], null, ' ')).toBe(false);
    });

    it('keeps the previous weight conversion semantics for empty and non-positive input', () => {
        const resetWeight = buildExerciseSavePayload([], null, { ...draft, equipmentWeight: '-2' }, () => 'ex-negative');
        const emptyWeight = buildExerciseSavePayload([], null, { ...draft, equipmentWeight: '' }, () => 'ex-empty');
        expect(resetWeight?.equipmentWeight).toBeUndefined();
        expect(emptyWeight?.equipmentWeight).toBeUndefined();
    });
});
