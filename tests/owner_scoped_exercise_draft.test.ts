import { beforeEach, describe, expect, it } from 'vitest';
import {
    clearExerciseDraft,
    EXERCISE_DRAFT_KEY,
    persistExerciseDraft,
    readExerciseDraft,
} from '../src/hooks/trainingExercises/exerciseDraft';
import { deviceKey } from '../src/lib/sync/deviceStorage';

describe('owner-scoped exercise draft', () => {
    beforeEach(() => localStorage.clear());

    it('keeps private draft content inside the explicit owner namespace', () => {
        const draft = {
            name: 'Panca privata',
            notes: 'nota account A',
            trackingType: 'weight_reps' as const,
            selectedMuscles: [],
            secondaryMuscles: [],
            isBodyweight: false,
            equipmentWeight: '',
        };

        persistExerciseDraft(draft, 'user:a');

        expect(localStorage.getItem(EXERCISE_DRAFT_KEY)).toBeNull();
        expect(localStorage.getItem(deviceKey(EXERCISE_DRAFT_KEY, 'user:a'))).not.toBeNull();
        expect(readExerciseDraft('user:a')?.name).toBe('Panca privata');
        expect(readExerciseDraft('user:b')).toBeNull();

        clearExerciseDraft('user:a');
        expect(readExerciseDraft('user:a')).toBeNull();
    });
});
