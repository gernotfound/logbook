import { beforeEach, describe, expect, it } from 'vitest';
import { deviceKey } from '../../lib/sync/deviceStorage';
import {
  clearExerciseDraft,
  persistExerciseDraft,
  readExerciseDraft,
  type ExerciseDraft,
} from './exerciseDraft';

const draft: ExerciseDraft = {
  name: 'Panca privata',
  notes: 'Nota account A',
  trackingType: 'weight_reps',
  selectedMuscles: [],
  secondaryMuscles: [],
  isBodyweight: false,
  equipmentWeight: '20',
};

describe('exercise draft owner isolation', () => {
  beforeEach(() => localStorage.clear());

  it('keeps drafts isolated between owners and never writes the legacy global key', () => {
    persistExerciseDraft(draft, 'user:a');

    expect(readExerciseDraft('user:a')?.name).toBe('Panca privata');
    expect(readExerciseDraft('user:b')).toBeNull();
    expect(localStorage.getItem(deviceKey('draft_exercise', 'user:a'))).not.toBeNull();
    expect(localStorage.getItem('draft_exercise')).toBeNull();

    clearExerciseDraft('user:a');
    expect(readExerciseDraft('user:a')).toBeNull();
  });
});
