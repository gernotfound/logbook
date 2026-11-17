import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import DataMeasurements from '../../../src/components/Data/DataMeasurements';
import { SessionRatings } from '../../../src/components/Training/session/SessionRatings';
import { useAppStore } from '../../../src/store/useAppStore';
import type { UserData } from '../../../src/types';
import { createDefaultNutritionPlanning } from '../../../src/lib/nutritionDefaults';

describe('Measurement and session UI wording', () => {
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

    describe('User-facing measurement and rating labels', () => {
        it('DataMeasurements renders the approved optional-measurements disclosure', () => {
            render(
                <DataMeasurements
                    profile={{ gender: 'M' }}
                    measureTime=""
                    setMeasureTime={vi.fn()}
                    weight=""
                    setWeight={vi.fn()}
                    waist=""
                    setWaist={vi.fn()}
                    neck=""
                    setNeck={vi.fn()}
                    hip=""
                    setHip={vi.fn()}
                    chest=""
                    setChest={vi.fn()}
                    shoulders=""
                    setShoulders={vi.fn()}
                    biceps=""
                    setBiceps={vi.fn()}
                    thighs=""
                    setThighs={vi.fn()}
                    calves=""
                    setCalves={vi.fn()}
                    handleCancelEdit={vi.fn()}
                    calculateAndSave={vi.fn()}
                />
            );

            expect(screen.getByText('Altre misurazioni')).toBeDefined();
        });

        it('SessionRatings renders Valuta sessione in sentence case', () => {
            render(
                <SessionRatings
                    water=""
                    setWater={vi.fn()}
                    mood=""
                    setMood={vi.fn()}
                    pump=""
                    setPump={vi.fn()}
                    fatigue=""
                    setFatigue={vi.fn()}
                />
            );

            expect(screen.getByText('Valuta sessione')).toBeDefined();
        });
    });
});
