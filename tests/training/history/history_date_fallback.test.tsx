import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import TrainingHistory from '../../../src/components/Training/TrainingHistory';
import { useAppStore } from '../../../src/store/useAppStore';
import type { WorkoutSession, UserData } from '../../../src/types';
import { createDefaultNutritionPlanning } from '../../../src/lib/nutritionDefaults';

describe('Historical workout date fallback', () => {
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

    describe('P2-6: TrainingHistory Date Fallback', () => {
        it('renders historical date from wo.date when globalStartTime is absent', () => {
            const historicalWorkout: WorkoutSession = {
                id: 'w_hist_1',
                date: '2025-12-25',
                routineName: 'Christmas Workout',
                exercises: [{ exId: 'ex_1', sessionNote: '', sets: [{ id: 's1', kg: '100', reps: '10' }] }]
            };

            useAppStore.setState({
                dataOwner: 'user:test-user-id',
                userData: {
                    ...useAppStore.getState().userData!,
                    history: [historicalWorkout]
                }
            });

            render(<TrainingHistory />);

            expect(screen.getByText('Christmas Workout')).toBeDefined();
            // Should contain 25 and dic/dec and 2025
            const historyText = screen.getByText(/25.*2025/i);
            expect(historyText).toBeDefined();
        });
    });
});
