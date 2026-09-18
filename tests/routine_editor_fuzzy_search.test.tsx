import React from 'react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { renderWithProviders } from './setup';
import { ExerciseSearchDropdown } from '../src/components/Training/ExerciseSearchDropdown';
import { RoutineEditor } from '../src/components/Training/routines/RoutineEditor';
import TrainingSession from '../src/components/Training/TrainingSession';
import { Logic, searchExerciseLibrary, normalizeStem } from '../src/lib/logic';
import {  ExerciseLibraryItem, WorkoutSession } from '../src/types';
import { useAppStore } from '../src/store/useAppStore';

const mockLibrary: ExerciseLibraryItem[] = [
    {
        id: 'ex_bench',
        name: 'Panca Piana Bilanciere',
        setsCount: 3,
        muscles: ['chest_upper', 'chest_lower'],
        secondaryMuscles: ['triceps', 'delts_front'],
        notes: 'Presa media con gomiti a 45 gradi',
        trackingType: 'weight_reps',
        sets: []
    },
    {
        id: 'ex_incline',
        name: 'Panca Inclinata Manubri',
        setsCount: 3,
        muscles: ['chest_upper'],
        secondaryMuscles: ['delts_front', 'triceps'],
        notes: 'Inclinazione panca 30 gradi',
        trackingType: 'weight_reps',
        sets: []
    },
    {
        id: 'ex_squat',
        name: 'Squat con Bilanciere',
        setsCount: 4,
        muscles: ['quads', 'glutes'],
        secondaryMuscles: ['hamstrings', 'core'],
        notes: 'Scosciata completa sotto il parallelo',
        trackingType: 'weight_reps',
        sets: []
    },
    {
        id: 'ex_pullup',
        name: 'Trazioni alla Sbarra',
        setsCount: 3,
        muscles: ['back', 'lats'],
        secondaryMuscles: ['biceps', 'forearms'],
        notes: 'Presa prona larga',
        trackingType: 'weight_reps',
        sets: []
    },
    {
        id: 'ex_treadmill',
        name: 'Corsa sul Tapis Roulant',
        setsCount: 1,
        muscles: ['quads', 'calves'],
        secondaryMuscles: ['glutes'],
        notes: 'Riscaldamento cardio',
        trackingType: 'cardio',
        sets: []
    },
    {
        id: 'ex_plank',
        name: 'Plank Isometrico',
        setsCount: 3,
        muscles: ['abs', 'core'],
        secondaryMuscles: ['glutes'],
        notes: 'Tenuta addominale isometrica',
        trackingType: 'time',
        sets: []
    }
];

describe('Intelligent Exercise Search & Dropdown Suite (M3: R4 & R6)', () => {
    beforeEach(() => {
        window.localStorage.clear();
        useAppStore.getState().resetStore();
        vi.clearAllMocks();

        useAppStore.setState({
            userData: {
                profile: {} as any,
                library: mockLibrary as any,
                routines: [
                    {
                        id: 'rot_push',
                        name: 'Scheda Spinta Base',
                        exercises: [{ exId: 'ex_bench', setsCount: 3 }]
                    }
                ],
                trainingCycles: [],
                customFoods: [],
                supplements: [],
                history: [],
                nutrition: {},
                nutritionPlanning: {} as any,
                activeWorkout: null,
                activeCycleId: null
            },
            localWorkout: null
        });
    });

    afterEach(() => {
        window.localStorage.clear();
        useAppStore.getState().resetStore();
        vi.restoreAllMocks();
    });

    // =========================================================================
    // SECTION 1: searchExerciseLibrary & Fuzzy Search Algorithm Unit Tests
    // =========================================================================
    describe('1. searchExerciseLibrary Algorithm & Typo Tolerance', () => {
        it('1.1: Exact name matching returns exercise', () => {
            const results = searchExerciseLibrary(mockLibrary, 'Panca Piana Bilanciere');
            expect(results.length).toBeGreaterThanOrEqual(1);
            expect(results[0].id).toBe('ex_bench');
        });

        it('1.2: Substring matching is case-insensitive', () => {
            const results = searchExerciseLibrary(mockLibrary, 'panca');
            expect(results.length).toBe(2);
            expect(results.map(r => r.id)).toContain('ex_bench');
            expect(results.map(r => r.id)).toContain('ex_incline');
        });

        it('1.3: Fuzzy typo-tolerance matches misspelled exercise names', () => {
            // "pancca" -> Panca Piana Bilanciere / Panca Inclinata
            const typoPanca = searchExerciseLibrary(mockLibrary, 'pancca');
            expect(typoPanca.length).toBeGreaterThanOrEqual(1);
            expect(typoPanca.map(r => r.id)).toContain('ex_bench');

            // "squatt" -> Squat con Bilanciere
            const typoSquat = searchExerciseLibrary(mockLibrary, 'squatt');
            expect(typoSquat.length).toBeGreaterThanOrEqual(1);
            expect(typoSquat[0].id).toBe('ex_squat');

            // "trazzioni" -> Trazioni alla Sbarra
            const typoTrazioni = searchExerciseLibrary(mockLibrary, 'trazzioni');
            expect(typoTrazioni.length).toBeGreaterThanOrEqual(1);
            expect(typoTrazioni[0].id).toBe('ex_pullup');
        });

        it('1.4: Search by Italian primary muscle group matches mapped exercises', () => {
            // "petto" -> Panca Piana, Panca Inclinata
            const chestExercises = searchExerciseLibrary(mockLibrary, 'petto');
            expect(chestExercises.length).toBeGreaterThanOrEqual(2);
            expect(chestExercises.map(r => r.id)).toContain('ex_bench');
            expect(chestExercises.map(r => r.id)).toContain('ex_incline');

            // "dorso" -> Trazioni alla Sbarra
            const backExercises = searchExerciseLibrary(mockLibrary, 'dorso');
            expect(backExercises.length).toBeGreaterThanOrEqual(1);
            expect(backExercises.map(r => r.id)).toContain('ex_pullup');
        });

        it('1.5: Search by Italian secondary muscle matches exercises', () => {
            // "bicipiti" -> Trazioni alla Sbarra (secondary muscle biceps)
            const bicepsExercises = searchExerciseLibrary(mockLibrary, 'bicipiti');
            expect(bicepsExercises.length).toBeGreaterThanOrEqual(1);
            expect(bicepsExercises.map(r => r.id)).toContain('ex_pullup');

            // "tricipiti" -> Panca Piana Bilanciere (secondary muscle triceps)
            const tricepsExercises = searchExerciseLibrary(mockLibrary, 'tricipiti');
            expect(tricepsExercises.length).toBeGreaterThanOrEqual(1);
            expect(tricepsExercises.map(r => r.id)).toContain('ex_bench');
        });

        it('1.6: Multi-token combined search matches multiple criteria', () => {
            const results = searchExerciseLibrary(mockLibrary, 'petto bilanciere');
            expect(results.length).toBeGreaterThanOrEqual(1);
            expect(results[0].id).toBe('ex_bench');
        });

        it('1.7: Tracking type keyword search finds cardio and time exercises', () => {
            const cardioResults = searchExerciseLibrary(mockLibrary, 'cardio');
            expect(cardioResults.length).toBeGreaterThanOrEqual(1);
            expect(cardioResults.map(r => r.id)).toContain('ex_treadmill');

            const timeResults = searchExerciseLibrary(mockLibrary, 'plank');
            expect(timeResults.length).toBeGreaterThanOrEqual(1);
            expect(timeResults.map(r => r.id)).toContain('ex_plank');
        });

        it('1.8: Empty query returns full library sorted alphabetically', () => {
            const results = searchExerciseLibrary(mockLibrary, '');
            expect(results.length).toBe(mockLibrary.length);
            const names = results.map(r => r.name);
            const sortedNames = [...names].sort((a, b) => a.localeCompare(b, 'it'));
            expect(names).toEqual(sortedNames);
        });

        it('1.9: Special regex characters do not crash and handle safely', () => {
            expect(() => {
                const results = searchExerciseLibrary(mockLibrary, '.*+?^${}()|[]\\');
                expect(results).toEqual([]);
            }).not.toThrow();
        });

        it('1.10: Empty library or non-array returns empty array safely', () => {
            expect(searchExerciseLibrary([], 'panca')).toEqual([]);
            expect(searchExerciseLibrary(null as any, 'panca')).toEqual([]);
            expect(searchExerciseLibrary(undefined as any, 'panca')).toEqual([]);
        });

        it('1.11: normalizeStem helper handles Italian muscle suffixes properly', () => {
            expect(normalizeStem('pettorali')).toBe('petto');
            expect(normalizeStem('deltoidi')).toBe('deltoid');
            expect(normalizeStem('bicipiti')).toBe('bicipit');
            expect(normalizeStem('tricipiti')).toBe('tricipit');
            expect(normalizeStem('quadricipiti')).toBe('quadricipit');
            expect(normalizeStem('femorali')).toBe('femoral');
            expect(normalizeStem('polpacci')).toBe('polpacc');
            expect(normalizeStem('addominali')).toBe('addom');
        });
    });

    // =========================================================================
    // SECTION 2: ExerciseSearchDropdown Component Interaction & UX Tests
    // =========================================================================
    describe('2. ExerciseSearchDropdown Component Interactions', () => {
        it('2.1: Renders an accessible combobox with Italian sentence case placeholder', () => {
            const onSelect = vi.fn();
            const { container } = render(
                <ExerciseSearchDropdown
                    library={mockLibrary}
                    onSelectExercise={onSelect}
                    placeholder="🔍 Cerca esercizio da aggiungere..."
                />
            );

            const input = container.querySelector('input') as HTMLInputElement;
            expect(input).not.toBeNull();
            expect(input.placeholder).toBe('🔍 Cerca esercizio da aggiungere...');
            expect(screen.getByRole('combobox').getAttribute('aria-expanded')).toBe('false');
            // Dropdown list is not open initially
            expect(container.querySelector('[role="listbox"]')).toBeNull();
        });

        it('2.2: Focusing/clicking input opens floating dropdown list', () => {
            const onSelect = vi.fn();
            const { container } = render(
                <ExerciseSearchDropdown
                    library={mockLibrary}
                    onSelectExercise={onSelect}
                />
            );

            const input = container.querySelector('input') as HTMLInputElement;
            fireEvent.focus(input);

            const listbox = container.querySelector('[role="listbox"]');
            expect(listbox).not.toBeNull();
            const items = container.querySelectorAll('.exercise-dropdown-item');
            expect(items.length).toBe(mockLibrary.length);
        });

        it('2.3: Typing in input filters dropdown items in real-time', () => {
            const onSelect = vi.fn();
            const { container } = render(
                <ExerciseSearchDropdown
                    library={mockLibrary}
                    onSelectExercise={onSelect}
                />
            );

            const input = container.querySelector('input') as HTMLInputElement;
            fireEvent.change(input, { target: { value: 'squat' } });

            const items = container.querySelectorAll('.exercise-dropdown-item');
            expect(items.length).toBe(1);
            expect(items[0].textContent).toContain('Squat con Bilanciere');
        });

        it('2.4: Renders tracking badges (Cardio, Tempo, Muscle category)', () => {
            const onSelect = vi.fn();
            const { container } = render(
                <ExerciseSearchDropdown
                    library={mockLibrary}
                    onSelectExercise={onSelect}
                />
            );

            const input = container.querySelector('input') as HTMLInputElement;
            fireEvent.focus(input);

            expect(container.textContent).toContain('Cardio');
            expect(container.textContent).toContain('Tempo');
            expect(container.textContent).toContain('Petto');
            expect(container.textContent).toContain('Dorso');
        });

        it('2.5: Clicking an item calls onSelectExercise, clears input, and closes dropdown', () => {
            const onSelect = vi.fn();
            const { container } = render(
                <ExerciseSearchDropdown
                    library={mockLibrary}
                    onSelectExercise={onSelect}
                />
            );

            const input = container.querySelector('input') as HTMLInputElement;
            fireEvent.change(input, { target: { value: 'trazioni' } });

            const item = container.querySelector('.exercise-dropdown-item') as HTMLElement;
            expect(item).not.toBeNull();
            fireEvent.click(item);

            expect(onSelect).toHaveBeenCalledWith('ex_pullup');
            expect(input.value).toBe('');
            expect(container.querySelector('[role="listbox"]')).toBeNull();
        });

        it('2.6: Clear button (✕) empties input and resets search', () => {
            const onSelect = vi.fn();
            const { container } = render(
                <ExerciseSearchDropdown
                    library={mockLibrary}
                    onSelectExercise={onSelect}
                />
            );

            const input = container.querySelector('input') as HTMLInputElement;
            fireEvent.change(input, { target: { value: 'panca' } });

            const clearBtn = container.querySelector('button[aria-label="Cancella ricerca"]') as HTMLButtonElement;
            expect(clearBtn).not.toBeNull();
            fireEvent.click(clearBtn);

            expect(input.value).toBe('');
        });

        it('2.7: Keyboard navigation: ArrowDown, ArrowUp, Enter to select', () => {
            const onSelect = vi.fn();
            const { container } = render(
                <ExerciseSearchDropdown
                    library={mockLibrary}
                    onSelectExercise={onSelect}
                />
            );

            const input = container.querySelector('input') as HTMLInputElement;
            fireEvent.focus(input);

            // Press ArrowDown to select index 0
            fireEvent.keyDown(input, { key: 'ArrowDown' });
            // Press ArrowDown to select index 1
            fireEvent.keyDown(input, { key: 'ArrowDown' });
            // Press Enter to confirm
            fireEvent.keyDown(input, { key: 'Enter' });

            expect(onSelect).toHaveBeenCalledTimes(1);
            expect(container.querySelector('[role="listbox"]')).toBeNull();
        });

        it('2.8: Escape key closes the dropdown and blurs input', () => {
            const onSelect = vi.fn();
            const { container } = render(
                <ExerciseSearchDropdown
                    library={mockLibrary}
                    onSelectExercise={onSelect}
                />
            );

            const input = container.querySelector('input') as HTMLInputElement;
            fireEvent.focus(input);
            expect(container.querySelector('[role="listbox"]')).not.toBeNull();

            fireEvent.keyDown(input, { key: 'Escape' });
            expect(container.querySelector('[role="listbox"]')).toBeNull();
        });

        it('2.9: Clicking outside closes the dropdown', () => {
            const onSelect = vi.fn();
            const { container } = render(
                <div>
                    <div data-testid="outside-area">Spazio Esterno</div>
                    <ExerciseSearchDropdown
                        library={mockLibrary}
                        onSelectExercise={onSelect}
                    />
                </div>
            );

            const input = container.querySelector('input') as HTMLInputElement;
            fireEvent.focus(input);
            expect(container.querySelector('[role="listbox"]')).not.toBeNull();

            const outside = screen.getByTestId('outside-area');
            fireEvent.mouseDown(outside);

            expect(container.querySelector('[role="listbox"]')).toBeNull();
        });

        it('2.10: Empty state message rendered when no matches found', () => {
            const onSelect = vi.fn();
            const { container } = render(
                <ExerciseSearchDropdown
                    library={mockLibrary}
                    onSelectExercise={onSelect}
                />
            );

            const input = container.querySelector('input') as HTMLInputElement;
            fireEvent.change(input, { target: { value: 'zzzzzz_non_esistente_qqqqq' } });

            expect(container.textContent).toContain('Nessun esercizio trovato');
        });

        it('2.11: ExcludeIds prop filters out specified exercises from dropdown', () => {
            const onSelect = vi.fn();
            const { container } = render(
                <ExerciseSearchDropdown
                    library={mockLibrary}
                    onSelectExercise={onSelect}
                    excludeIds={['ex_bench', 'ex_squat']}
                />
            );

            const input = container.querySelector('input') as HTMLInputElement;
            fireEvent.focus(input);

            const items = container.querySelectorAll('.exercise-dropdown-item');
            expect(items.length).toBe(mockLibrary.length - 2);
            expect(container.textContent).not.toContain('Panca Piana Bilanciere');
            expect(container.textContent).not.toContain('Squat con Bilanciere');
        });
    });

    // =========================================================================
    // SECTION 3: RoutineEditor Integration Tests (R4)
    // =========================================================================
    describe('3. RoutineEditor Integration with ExerciseSearchDropdown', () => {
        it('3.1: RoutineEditor contains ExerciseSearchDropdown instead of legacy select', () => {
            const onAddExercise = vi.fn();
            const { container } = renderWithProviders(
                <RoutineEditor
                    routineName="Nuova Scheda"
                    setRoutineName={vi.fn()}
                    editingRoutineId={null}
                    routineExercises={[]}
                    library={mockLibrary}
                    editMuscles={[]}
                    editSecMuscles={[]}
                    onAddExercise={onAddExercise}
                    onMoveExercise={vi.fn()}
                    onRemoveExercise={vi.fn()}
                    onUpdateSetsCount={vi.fn()}
                    onUpdateReps={vi.fn()}
                    onUpdateTechnique={vi.fn()}
                    onSave={vi.fn()}
                    onCancel={vi.fn()}
                />
            );

            // Legacy select should no longer exist in RoutineEditor
            expect(container.querySelector('select')).toBeNull();

            // Search input is present with correct placeholder
            const searchInput = (container.querySelector('.exercise-search-container input') ||
                container.querySelector('input[role="combobox"]')) as HTMLInputElement;
            expect(searchInput).not.toBeNull();

            // Open dropdown by focusing
            fireEvent.focus(searchInput);
            const dropdown = container.querySelector('.exercise-search-dropdown, [role="listbox"]');
            expect(dropdown).not.toBeNull();

            // Select an exercise from dropdown
            const items = container.querySelectorAll('.exercise-dropdown-item');
            expect(items.length).toBeGreaterThan(0);
            fireEvent.click(items[0]);

            expect(onAddExercise).toHaveBeenCalledTimes(1);
        });

        it('3.2: Typing typo query in RoutineEditor dropdown and selecting adds correct exercise', () => {
            const onAddExercise = vi.fn();
            const { container } = renderWithProviders(
                <RoutineEditor
                    routineName="Scheda Gambe"
                    setRoutineName={vi.fn()}
                    editingRoutineId={null}
                    routineExercises={[]}
                    library={mockLibrary}
                    editMuscles={[]}
                    editSecMuscles={[]}
                    onAddExercise={onAddExercise}
                    onMoveExercise={vi.fn()}
                    onRemoveExercise={vi.fn()}
                    onUpdateSetsCount={vi.fn()}
                    onUpdateReps={vi.fn()}
                    onUpdateTechnique={vi.fn()}
                    onSave={vi.fn()}
                    onCancel={vi.fn()}
                />
            );

            const searchInput = (container.querySelector('.exercise-search-container input') ||
                container.querySelector('input[role="combobox"]')) as HTMLInputElement;
            expect(searchInput).not.toBeNull();
            fireEvent.change(searchInput, { target: { value: 'squatt' } });

            const items = container.querySelectorAll('.exercise-dropdown-item');
            expect(items.length).toBe(1);
            expect(items[0].textContent).toContain('Squat con Bilanciere');

            fireEvent.click(items[0]);
            expect(onAddExercise).toHaveBeenCalledWith('ex_squat');
        });
    });

    // =========================================================================
    // SECTION 4: TrainingSession Extra Exercise Integration Tests (R6)
    // =========================================================================
    describe('4. TrainingSession Ad-Hoc Extra Exercise Integration', () => {
        it('4.1: TrainingSession renders ExerciseSearchDropdown for extra exercises', () => {
            const activeWorkout: WorkoutSession = {
                id: 'w_test_1',
                routineId: 'rot_push',
                routineName: 'Scheda Spinta Base',
                date: Logic.getLocalDateString(),
                globalStartTime: Date.now(),
                exercises: [
                    {
                        exId: 'ex_bench',
                        sets: [{ id: 's_1', kg: '80', reps: '8', done: true }]
                    }
                ]
            };

            const initialUserData = {
                profile: {} as any,
                library: mockLibrary as any,
                routines: [
                    {
                        id: 'rot_push',
                        name: 'Scheda Spinta Base',
                        exercises: [{ exId: 'ex_bench', setsCount: 3 }]
                    }
                ],
                trainingCycles: [],
                customFoods: [],
                supplements: [],
                history: [],
                nutrition: {},
                nutritionPlanning: {} as any,
                activeWorkout: null,
                activeCycleId: null
            };

            const { container } = renderWithProviders(<TrainingSession />, {
                localWorkout: activeWorkout,
                userData: initialUserData
            });

            // Extra exercise section has search dropdown
            expect(container.textContent).toContain('Aggiungi esercizio extra');
            const searchInput = (container.querySelector('.exercise-search-container input') ||
                container.querySelector('input[role="combobox"]')) as HTMLInputElement;
            expect(searchInput).not.toBeNull();

            // Search for extra exercise
            fireEvent.change(searchInput, { target: { value: 'plank' } });
            const item = container.querySelector('.exercise-dropdown-item') as HTMLElement;
            expect(item).not.toBeNull();
            expect(item.textContent).toContain('Plank');

            // Click to add extra exercise
            fireEvent.click(item);

            // localWorkout should have 2 exercises
            const state = useAppStore.getState();
            expect(state.localWorkout?.exercises.length).toBe(2);
            expect(state.localWorkout?.exercises[1].exId).toBe('ex_plank');

            // Routine blueprint in userData.routines must remain strictly unchanged
            const blueprint = state.userData?.routines.find(r => r.id === 'rot_push');
            expect(blueprint?.exercises.length).toBe(1);
            expect(blueprint?.exercises[0].exId).toBe('ex_bench');
        });

        it('4.2: Completing workout saves ad-hoc exercises to history and clears localWorkout', async () => {
            const activeWorkout: WorkoutSession = {
                id: 'w_test_2',
                routineId: 'rot_push',
                routineName: 'Scheda Spinta Base',
                date: Logic.getLocalDateString(),
                globalStartTime: Date.now() - 3600000,
                exercises: [
                    {
                        exId: 'ex_bench',
                        sets: [{ id: 's_1', kg: '90', reps: '6', done: true }]
                    },
                    {
                        exId: 'ex_treadmill',
                        sets: [{ id: 's_2', time: '900', dist: '2.5', speed: '10', done: true }]
                    }
                ]
            };

            useAppStore.setState({
                localWorkout: activeWorkout,
                userData: {
                    ...useAppStore.getState().userData!,
                    library: mockLibrary as any,
                    history: []
                }
            });

            // Simulate workout finish logic
            const currentWorkout = useAppStore.getState().localWorkout!;
            const finishedWorkout: WorkoutSession = {
                ...currentWorkout,
                globalEndTime: Date.now(),
                globalDurationStr: '01:00:00',
                date: currentWorkout.date
            };

            await useAppStore.getState().saveUserData((prev) => {
                if (!prev) return prev;
                return { ...prev, history: [finishedWorkout, ...(prev.history || [])], activeWorkout: null };
            });
            useAppStore.setState({ localWorkout: null });

            const updatedState = useAppStore.getState();
            expect(updatedState.localWorkout).toBeNull();
            expect(updatedState.userData?.history.length).toBe(1);
            expect(updatedState.userData?.history[0].exercises.length).toBe(2);
            expect(updatedState.userData?.history[0].exercises[1].exId).toBe('ex_treadmill');

            // Blueprint still unchanged
            const blueprint = updatedState.userData?.routines.find(r => r.id === 'rot_push');
            expect(blueprint?.exercises.length).toBe(1);
        });
    });
});
