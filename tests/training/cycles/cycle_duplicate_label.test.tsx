import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, act } from '@testing-library/react';
import TrainingPlanning from '../../../src/components/Training/planning/TrainingPlanning';
import { useAppStore } from '../../../src/store/useAppStore';
import type { UserData } from '../../../src/types';
import { createDefaultNutritionPlanning } from '../../../src/lib/nutritionDefaults';

describe('Collision-safe cycle duplication labels', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        localStorage.clear();
        useAppStore.setState({
            dataOwner: 'user:test-user-id',
            userData: {
                profile: { gender: 'M' },
                library: [{ id: 'ex_1', name: 'Panca piana', setsCount: 3, sets: [] }],
                routines: [{ id: 'r_1', name: 'Push', exercises: [{ exId: 'ex_1', setsCount: 3 }] }],
                trainingCycles: [
                    {
                        id: 'cycle_1',
                        name: 'Mesociclo Massa',
                        durationWeeks: 6,
                        routines: [{ routineId: 'r_1', frequencyPerWeek: 2 }],
                        isActive: true
                    }
                ],
                activeCycleId: 'cycle_1',
                history: [],
                nutrition: {},
                customFoods: [],
                activeWorkout: null,
                nutritionPlanning: createDefaultNutritionPlanning(),
                supplements: [],
                activePains: [],
                catalogOverrides: { exercises: {}, foods: {} }
            } satisfies UserData,
            localWorkout: null
        });
    });

    describe('Cycle name duplication', () => {
        it('TrainingPlanning assigns a collision-safe numeric suffix when duplicating a cycle', async () => {
            render(<TrainingPlanning />);

            const optionsBtn = screen.getByTitle('Opzioni');
            await act(async () => {
                fireEvent.click(optionsBtn);
            });

            const dupBtn = screen.getByRole('menuitem', { name: /Duplica/i });
            await act(async () => {
                fireEvent.click(dupBtn);
            });

            const cycles = useAppStore.getState().userData?.trainingCycles || [];
            expect(cycles.some(c => c.name === 'Mesociclo Massa - 1')).toBe(true);
        });
    });
});
