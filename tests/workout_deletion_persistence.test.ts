import { describe, it, expect, vi, beforeEach } from 'vitest';
import { writeBatch, doc, getDoc } from 'firebase/firestore';

vi.unmock('../src/lib/db');

import { TestDB as DB } from './testUtils';
import { useAppStore } from '../src/store/useAppStore';
import { useDialogStore } from '../src/store/useDialogStore';
import { useTrainingHistory } from '../src/hooks/useTrainingHistory';
import { renderHook, act } from '@testing-library/react';
import type { UserData, WorkoutSession } from '../src/types';



describe('Workout Deletion & Subcollection Persistence', () => {
  let mockBatch: any;

  beforeEach(() => {
    vi.clearAllMocks();
    DB.resetCache();
    const remote = new Map<string, any>();
    vi.mocked(doc).mockImplementation((_db: any, ...path: string[]) => ({ path: path.join('/') }) as any);
    vi.mocked(getDoc).mockImplementation(async (ref: any) => ({ exists: () => remote.has(ref.path), data: () => remote.get(ref.path) }) as any);

    mockBatch = {
      set: vi.fn((ref: any, data: any) => remote.set(ref.path, data)),
      delete: vi.fn((ref: any) => remote.delete(ref.path)),
      commit: vi.fn().mockResolvedValue(undefined),
    };
    vi.mocked(writeBatch).mockReturnValue(mockBatch);
  });

  it('updates month document when deleting a single workout from a multi-workout month', async () => {
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

    // Initial state with 2 workouts in 2026-07
    const initialUserData: UserData = {
      profile: { name: 'Mario Rossi' },
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
      }
    };

    // Save initial state to establish oldState cache in DB
    await DB.saveUserData(initialUserData);
    expect(mockBatch.commit).toHaveBeenCalledTimes(1);
    mockBatch.set.mockClear();
    mockBatch.delete.mockClear();
    mockBatch.commit.mockClear();

    // Now delete workout1 (leaving workout2 in 2026-07)
    const updatedUserData: UserData = {
      ...initialUserData,
      history: [workout2]
    };

    await DB.saveUserData(updatedUserData);

    expect(mockBatch.commit).toHaveBeenCalledTimes(1);
    // Month 2026-07 still has workout2, so batch.set should be called for history_months/2026-07
    expect(mockBatch.set).toHaveBeenCalled();
    const setCalls = mockBatch.set.mock.calls;
    const historyMonthSetCall = setCalls.find((call: any[]) => {
      return call[1] && call[1]['w-jul-2'] && !call[1]['w-jul-1'];
    });
    expect(historyMonthSetCall).toBeDefined();
    expect(historyMonthSetCall[1]).toMatchObject({
      'w-jul-2': workout2
    });
    // Should NOT delete month 2026-07 because workout2 remains
    expect(mockBatch.delete).not.toHaveBeenCalled();
  });

  it('deletes month document from subcollection when deleting the last workout in that month', async () => {
    const workoutJul: WorkoutSession = {
      id: 'w-jul-sole',
      date: '2026-07-15',
      routineName: 'Leg Day',
      duration: '60m',
      exercises: []
    };
    const workoutAug: WorkoutSession = {
      id: 'w-aug-sole',
      date: '2026-08-01',
      routineName: 'Chest Day',
      duration: '45m',
      exercises: []
    };

    const initialUserData: UserData = {
      profile: { name: 'Luigi' },
      library: [],
      routines: [],
      history: [workoutJul, workoutAug],
      nutrition: {},
      customFoods: [],
      activeWorkout: null,
      catalogOverrides: {
        exercises: {},
        hiddenExerciseIds: [],
        foods: {},
        hiddenFoodIds: []
      }
    };

    // Save initial state
    await DB.saveUserData(initialUserData);
    mockBatch.set.mockClear();
    mockBatch.delete.mockClear();
    mockBatch.commit.mockClear();

    // Delete workoutJul, keeping only workoutAug
    const updatedUserData: UserData = {
      ...initialUserData,
      history: [workoutAug]
    };

    await DB.saveUserData(updatedUserData);

    expect(mockBatch.commit).toHaveBeenCalledTimes(1);
    // Month 2026-07 is now empty -> batch.delete must be called for that subcollection doc
    expect(mockBatch.delete).toHaveBeenCalledTimes(1);
  });

  it('useTrainingHistory hook deleteWorkout confirms and updates store properly', async () => {
    const workoutToDelete: WorkoutSession = {
      id: 'w-to-delete-999',
      date: '2026-08-20',
      routineName: 'Full Body',
      duration: '40m',
      exercises: []
    };

    useAppStore.setState({
      userData: {
        profile: {},
        library: [],
        routines: [],
        history: [workoutToDelete],
        nutrition: {},
        customFoods: [],
        activeWorkout: null,
      },
      localWorkout: {
        id: 'w-to-delete-999',
        routineName: 'Full Body',
        exercises: []
      } as any,
      syncing: false,
      saveError: null
    });

    // Mock confirmation dialog to accept
    vi.spyOn(useDialogStore.getState(), 'showConfirm').mockResolvedValue(true);

    const { result } = renderHook(() => useTrainingHistory());

    await act(async () => {
      await result.current.deleteWorkout('w-to-delete-999');
    });

    const storeState = useAppStore.getState();
    expect(storeState.userData?.history).toEqual([]);
    // localWorkout referencing the deleted workout should be cleaned up
    expect(storeState.localWorkout).toBeNull();
  });
});
