import { describe, it, expect, vi, beforeEach } from 'vitest';
import { writeBatch, doc, getDoc } from 'firebase/firestore';

vi.unmock('../src/lib/db');

import { diffDocuments, applySemanticOperations } from '../src/lib/sync/semanticProjection';
import { projectDocuments } from '../src/lib/sync/documentProjection';
import { TestDB as DB } from './testUtils';
import { useAppStore } from '../src/store/useAppStore';
import { useDialogStore } from '../src/store/useDialogStore';
import { useTrainingHistory } from '../src/hooks/useTrainingHistory';
import { renderHook, act } from '@testing-library/react';
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
    
    const ops = diffDocuments(baseDocs, desiredDocs, 'actor1', 1, { 'actor1': 1 });
    const { documents, syncMetas } = applySemanticOperations(baseDocs, ops);
    
    const monthDoc = documents.get('history_months/2026-07');
    expect(monthDoc).toBeDefined();
    expect(monthDoc?.['w-jul-2']).toBeDefined();
    expect(monthDoc?.['w-jul-1']).toBeUndefined();
  });

  it('deletes month document from subcollection when deleting the last workout in that month', () => {
    const workoutJul: WorkoutSession = {
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
      history: [workoutJul],
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
      history: []
    };

    const catalog = { exercises: [], foods: [] } as any;
    const baseDocs = projectDocuments(initialUserData, catalog);
    const desiredDocs = projectDocuments(updatedUserData, catalog);
    
    const ops = diffDocuments(baseDocs, desiredDocs, 'actor1', 1, { 'actor1': 1 });
    const { documents, syncMetas } = applySemanticOperations(baseDocs, ops);
    
    const monthDoc = documents.get('history_months/2026-07');
    expect(monthDoc).toBeDefined(); // V3 keeps the document
    const dataKeys = Object.keys(monthDoc ?? {}).filter(k => k !== '_sync');
    expect(dataKeys.length).toBe(0); // Zero business data keys
    
    const meta = syncMetas['history_months/2026-07'];
    expect(meta).toBeDefined();
    expect(meta.fields['w-jul-sole/id']?.deleted).toBe(true);
  });
});
