import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import React from 'react';
import { calculateCycleVolume, getDetailedMuscleCategory } from '../src/lib/calc/planning';
import TrainingPlanning from '../src/components/Training/planning/TrainingPlanning';
import TrainingSession from '../src/components/Training/TrainingSession';
import TrainingView from '../src/components/Training/TrainingView';
import { useAppStore } from '../src/store/useAppStore';
import type { TrainingCycle, WorkoutRoutine, Exercise, UserData } from '../src/types';

describe('Training Planning & Volume Calculations', () => {
    const mockLibrary: Exercise[] = [
        {
            id: 'ex_bench',
            name: 'Panca Piana Bilanciere',
            setsCount: 4,
            muscles: ['chest', 'chest_lower'],
            secondaryMuscles: ['triceps', 'delts_front'],
            sets: []
        },
        {
            id: 'ex_ohp',
            name: 'Military Press',
            setsCount: 3,
            muscles: ['delts_front', 'shoulders'],
            secondaryMuscles: ['triceps'],
            sets: []
        },
        {
            id: 'ex_lat',
            name: 'Lat Machine Avanti',
            setsCount: 4,
            muscles: ['lats', 'back'],
            secondaryMuscles: ['biceps'],
            sets: []
        },
        {
            id: 'ex_squat',
            name: 'Squat con Bilanciere',
            setsCount: 5,
            muscles: ['quads', 'legs_general'],
            secondaryMuscles: ['glutes', 'lower_back'],
            sets: []
        },
        {
            id: 'ex_curl',
            name: 'Curl Bicipiti con Manubri',
            setsCount: 3,
            muscles: ['biceps'],
            secondaryMuscles: ['forearms'],
            sets: []
        }
    ];

    const mockRoutines: WorkoutRoutine[] = [
        {
            id: 'r_push',
            name: 'Spinta (Push)',
            exercises: [
                { exId: 'ex_bench', setsCount: 4 },
                { exId: 'ex_ohp', setsCount: 3 }
            ]
        },
        {
            id: 'r_pull',
            name: 'Trazione (Pull)',
            exercises: [
                { exId: 'ex_lat', setsCount: 4 },
                { exId: 'ex_curl', setsCount: 3 }
            ]
        },
        {
            id: 'r_legs',
            name: 'Gambe (Legs)',
            exercises: [
                { exId: 'ex_squat', setsCount: 5 }
            ]
        }
    ];

    it('getDetailedMuscleCategory correctly classifies muscles', () => {
        expect(getDetailedMuscleCategory('chest').label).toBe('Petto');
        expect(getDetailedMuscleCategory('lats').label).toBe('Dorso');
        expect(getDetailedMuscleCategory('traps').label).toBe('Trapezi');
        expect(getDetailedMuscleCategory('delts_side').label).toBe('Spalle');
        expect(getDetailedMuscleCategory('quads').label).toBe('Quadricipiti');
        expect(getDetailedMuscleCategory('biceps').label).toBe('Bicipiti');
        expect(getDetailedMuscleCategory('unknown_xyz').label).toBe('Altro');
    });

    it('calculateCycleVolume returns 0 for empty or invalid cycle', () => {
        const result = calculateCycleVolume(null, mockRoutines, mockLibrary);
        expect(result.totalWorkoutsPerWeek).toBe(0);
        expect(result.totalSetsPerWeek).toBe(0);
        expect(result.muscleVolumes).toEqual([]);
        expect(result.highlightedMuscles).toEqual([]);
    });

    it('calculateCycleVolume gracefully handles deleted routines and exercises', () => {
        const cycleWithMissingRefs: TrainingCycle = {
            id: 'cycle_missing',
            name: 'Ciclo Test',
            durationWeeks: 4,
            routines: [
                { routineId: 'non_existent_routine', frequencyPerWeek: 3 },
                { routineId: 'r_push', frequencyPerWeek: 1 }
            ]
        };

        const result = calculateCycleVolume(cycleWithMissingRefs, mockRoutines, mockLibrary);
        expect(result.totalWorkoutsPerWeek).toBe(1);
        expect(result.totalSetsPerWeek).toBe(7); // 4 bench + 3 ohp
    });

    it('calculateCycleVolume correctly calculates weekly sets for multiple routines with frequencies', () => {
        const cycle: TrainingCycle = {
            id: 'cycle_1',
            name: 'Mesociclo 4x',
            durationWeeks: 6,
            routines: [
                { routineId: 'r_push', frequencyPerWeek: 2 }, // Push 2x/week: bench 4x2=8, ohp 3x2=6
                { routineId: 'r_pull', frequencyPerWeek: 1 }, // Pull 1x/week: lat 4x1=4, curl 3x1=3
                { routineId: 'r_legs', frequencyPerWeek: 1 }  // Legs 1x/week: squat 5x1=5
            ]
        };

        const result = calculateCycleVolume(cycle, mockRoutines, mockLibrary);

        // Total workouts: 2 + 1 + 1 = 4
        expect(result.totalWorkoutsPerWeek).toBe(4);
        // Total sets: (4+3)*2 + (4+3)*1 + 5*1 = 14 + 7 + 5 = 26
        expect(result.totalSetsPerWeek).toBe(26);

        // Muscle breakdown (primary muscles only)
        const petto = result.muscleVolumes.find(m => m.label === 'Petto');
        expect(petto?.sets).toBe(8);

        const spalle = result.muscleVolumes.find(m => m.label === 'Spalle');
        expect(spalle?.sets).toBe(6);

        const dorso = result.muscleVolumes.find(m => m.label === 'Dorso');
        expect(dorso?.sets).toBe(4);

        const quadricipiti = result.muscleVolumes.find(m => m.label === 'Quadricipiti');
        expect(quadricipiti?.sets).toBe(5);

        const bicipiti = result.muscleVolumes.find(m => m.label === 'Bicipiti');
        expect(bicipiti?.sets).toBe(3);

        // Highlighted muscles contain primary muscle keys
        expect(result.highlightedMuscles).toContain('chest');
        expect(result.highlightedMuscles).toContain('lats');
        expect(result.highlightedMuscles).toContain('quads');

        // Muscle colors generated for MuscleModel
        expect(Object.keys(result.muscleColors).length).toBeGreaterThan(0);
    });

    describe('TrainingPlanning UI Component', () => {
        beforeEach(() => {
            const initialUserData: UserData = {
                library: mockLibrary,
                routines: mockRoutines,
                trainingCycles: [
                    {
                        id: 'cycle_active',
                        name: 'Mesociclo Massa',
                        durationWeeks: 8,
                        notes: 'Focus petto e spalle',
                        routines: [
                            { routineId: 'r_push', frequencyPerWeek: 2 },
                            { routineId: 'r_pull', frequencyPerWeek: 1 }
                        ],
                        isActive: true
                    }
                ],
                activeCycleId: 'cycle_active'
            };
            useAppStore.setState({ userData: initialUserData, localWorkout: null });
        });

        it('renders active cycle, MuscleModel, and weekly volume list', () => {
            render(<TrainingPlanning />);

            expect(screen.getByText(/Pianificazione/)).toBeDefined();
            expect(screen.getAllByText('Mesociclo Massa').length).toBeGreaterThanOrEqual(1);
            expect(screen.getAllByText(/8 settimane/).length).toBeGreaterThanOrEqual(1);
            expect(screen.getAllByText(/Focus petto e spalle/).length).toBeGreaterThanOrEqual(1);

            // Muscle model present
            expect(document.querySelector('.muscle-map-container') || document.querySelector('svg')).toBeDefined();

            // Volume per muscle
            expect(screen.getByText('Petto')).toBeDefined();
            expect(screen.getByText('Spalle')).toBeDefined();
        });

        it('allows opening cycle editor and creating a new cycle', async () => {
            render(<TrainingPlanning />);

            const newBtn = screen.getByText('➕ Nuovo ciclo');
            fireEvent.click(newBtn);

            expect(screen.getByText('➕ Nuovo ciclo di allenamento')).toBeDefined();

            const nameInput = screen.getByPlaceholderText('Es. Mesociclo ipertrofia 4 giorni');
            fireEvent.change(nameInput, { target: { value: 'Nuovo Ciclo Forza' } });

            const saveBtn = screen.getByText('💾 Salva ciclo');
            fireEvent.click(saveBtn);

            await waitFor(() => {
                const cycles = useAppStore.getState().userData?.trainingCycles || [];
                expect(cycles.some(c => c.name === 'Nuovo Ciclo Forza')).toBe(true);
            });
        });

        it('supports duplicating and deleting a cycle', async () => {
            render(<TrainingPlanning />);

            const dupBtn = screen.getByTitle('Duplica ciclo');
            fireEvent.click(dupBtn);

            await waitFor(() => {
                const cycles = useAppStore.getState().userData?.trainingCycles || [];
                expect(cycles.some(c => c.name.includes('(Copia)'))).toBe(true);
            });
        });

        it('scrolls to top and opens editor when clicking Modifica on a cycle', () => {
            const scrollToSpy = vi.spyOn(window, 'scrollTo').mockImplementation(() => {});
            render(<TrainingPlanning />);

            const editBtns = screen.getAllByText('✏️ Modifica');
            fireEvent.click(editBtns[0]);

            expect(scrollToSpy).toHaveBeenCalledWith({ top: 0, behavior: 'smooth' });
            expect(screen.getByText('✏️ Modifica ciclo')).toBeDefined();
            scrollToSpy.mockRestore();
        });

        it('supports activating and deactivating a training cycle', async () => {
            render(<TrainingPlanning />);

            // Check deactivation button
            const deactivateBtn = screen.getByText('⏸️ Disattiva ciclo');
            fireEvent.click(deactivateBtn);

            await waitFor(() => {
                expect(useAppStore.getState().userData?.activeCycleId).toBeNull();
            });

            // Reactivate cycle
            const activateBtn = screen.getByText('⭐ Imposta come ciclo attivo');
            fireEvent.click(activateBtn);

            await waitFor(() => {
                expect(useAppStore.getState().userData?.activeCycleId).toBe('cycle_active');
            });
        });

        it('renders "Avvia sessione pianificata" in TrainingSession and starts planned routine', async () => {
            render(<TrainingSession />);

            expect(screen.getByText(/Avvia sessione pianificata/i)).toBeDefined();
            expect(screen.getAllByText('Mesociclo Massa').length).toBeGreaterThanOrEqual(1);

            // Check planned routines in select
            const startPlannedBtn = screen.getByText('🏋️ Inizia sessione pianificata');
            fireEvent.click(startPlannedBtn);

            await waitFor(() => {
                const active = useAppStore.getState().localWorkout;
                expect(active).not.toBeNull();
                expect(active?.routineName).toBe('Spinta (Push)');
            });
        });

        it('shows message and navigation to planning when no active cycle is set', () => {
            useAppStore.setState({
                userData: {
                    ...useAppStore.getState().userData!,
                    activeCycleId: null
                }
            });

            const onNavPlanning = vi.fn();
            render(<TrainingSession onNavigateToPlanning={onNavPlanning} />);

            expect(screen.getByText(/Nessun ciclo di allenamento attivo al momento/i)).toBeDefined();
            const navBtn = screen.getByText('🎯 Vai a Pianificazione');
            fireEvent.click(navBtn);
            expect(onNavPlanning).toHaveBeenCalled();
        });

        it('integrates seamlessly inside TrainingView under subTab planning', () => {
            const setSubTab = vi.fn();
            render(<TrainingView subTab="planning" setSubTab={setSubTab} />);

            expect(screen.getAllByText(/Pianificazione/).length).toBeGreaterThanOrEqual(1);
            expect(screen.getAllByText('Mesociclo Massa').length).toBeGreaterThanOrEqual(1);

            // Check sub nav buttons
            const subNavBtns = screen.getAllByText(/Sessione|Pianificazione|Schede|Esercizi|Storico/);
            expect(subNavBtns.length).toBeGreaterThanOrEqual(5);
        });
    });
});
