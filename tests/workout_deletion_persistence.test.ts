import { describe, expect, it } from 'vitest';
import { applySemanticOperations, diffDocuments } from '../src/lib/sync/semanticProjection';
import { projectDocuments } from '../src/lib/sync/documentProjection';
import type { UserData, WorkoutSession } from '../src/types';

describe('Workout Deletion & Subcollection Persistence (V3)', () => {
  it('updates month document when deleting a single workout from a multi-workout month', () => {
    const workout1: WorkoutSession = {
      id: 'w-jul-1',
      date: '2026-07-10',
      routineName: 'Upper Body A',
      duration: '50m',
      exercises: []
    };
    const workout2: WorkoutSession = {
      id: 'w-jul-2',
      date: '2026-07-20',
      routineName: 'Lower Body A',
      duration: '45m',
      exercises: []
    };

    const initialUserData: UserData = {
      profile: {},
      library: [],
      routines: [],
      history: [workout1, workout2],
      nutrition: {},
      customFoods: [],
      activeWorkout: null,
      catalogOverrides: {
        exercises: {},
        hiddenExerciseIds: [],
        foods: {},
        hiddenFoodIds: []
      },
      trainingCycles: [],
      supplements: [],
      activePains: []
    };

    const updatedUserData: UserData = {
      ...initialUserData,
      history: [workout2]
    };

    const catalog = { exercises: [], foods: [] } as any;
    const baseDocs = projectDocuments(initialUserData, catalog);
    const desiredDocs = projectDocuments(updatedUserData, catalog);
    const ops = diffDocuments(baseDocs, desiredDocs, 'actor1', 1, { actor1: 1 });
    const { documents, syncMetas } = applySemanticOperations(baseDocs, ops);

    const monthDoc = documents.get('history_months/2026-07');
    expect(monthDoc?.['w-jul-2']).toBeDefined();
    expect(monthDoc?.['w-jul-1']).toBeUndefined();
    expect(syncMetas['history_months/2026-07'].fields['w-jul-1']?.deleted).toBe(true);
  });

  it('keeps a tombstone-only month after deleting the last workout', () => {
    const workout: WorkoutSession = {
      id: 'w-jul-sole',
      date: '2026-07-15',
      routineName: 'Leg Day',
      duration: '60m',
      exercises: []
    };

    const initialUserData: UserData = {
      profile: {},
      library: [],
      routines: [],
      history: [workout],
      nutrition: {},
      customFoods: [],
      activeWorkout: null,
      catalogOverrides: {
        exercises: {},
        hiddenExerciseIds: [],
        foods: {},
        hiddenFoodIds: []
      },
      trainingCycles: [],
      supplements: [],
      activePains: []
    };

    const updatedUserData: UserData = { ...initialUserData, history: [] };
    const catalog = { exercises: [], foods: [] } as any;
    const baseDocs = projectDocuments(initialUserData, catalog);
    const desiredDocs = projectDocuments(updatedUserData, catalog);
    const ops = diffDocuments(baseDocs, desiredDocs, 'actor1', 1, { actor1: 1 });
    const { documents, syncMetas } = applySemanticOperations(baseDocs, ops);

    const monthDoc = documents.get('history_months/2026-07');
    expect(monthDoc).toBeDefined();
    expect(Object.keys(monthDoc ?? {})).toHaveLength(0);
    expect(syncMetas['history_months/2026-07'].fields['w-jul-sole']?.deleted).toBe(true);
  });
});
