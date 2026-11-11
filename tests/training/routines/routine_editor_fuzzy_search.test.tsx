import React from 'react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { renderWithAuthenticatedTestOwner, renderWithProviders, emptyUserData } from '../../setup';
import { prepareUnlockedTestArchive } from '../../secureVaultFixture';
import { captureSession } from '../../../src/lib/sync/session';
import { initializeLocal } from '../../../src/lib/sync/localRepository';
import { ExerciseSearchDropdown } from '../../../src/components/Training/ExerciseSearchDropdown';
import { RoutineEditor } from '../../../src/components/Training/routines/RoutineEditor';
import TrainingSession from '../../../src/components/Training/TrainingSession';
import { Logic, normalizeStem } from '../../../src/lib/logic';
import { createExerciseLibrarySearcher } from '../../../src/lib/calc/workout';
import {  ExerciseLibraryItem, WorkoutSession } from '../../../src/types';
import { useAppStore } from '../../../src/store/useAppStore';

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
    beforeEach(async () => {
        window.localStorage.clear();
        localStorage.setItem('logbook:v2:user:test-user-id:health-consent-generation', '1');
        useAppStore.getState().resetStore();
        vi.clearAllMocks();

        useAppStore.setState({
            dataOwner: captureSession().owner,
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
    // SECTION 1: createExerciseLibrarySearcher & Fuzzy Search Algorithm Unit Tests
    // =========================================================================
    describe('1. createExerciseLibrarySearcher Algorithm & Typo Tolerance', () => {
        it('1.1: Exact name matching returns exercise', () => {
            const results = createExerciseLibrarySearcher(mockLibrary)('Panca Piana Bilanciere');
            expect(results.length).toBeGreaterThanOrEqual(1);
            expect(results[0].id).toBe('ex_bench');
        });

        it('1.2: Substring matching is case-insensitive', () => {
            const results = createExerciseLibrarySearcher(mockLibrary)('panca');
            expect(results.length).toBe(2);
            expect(results.map(r => r.id)).toContain('ex_bench');
            expect(results.map(r => r.id)).toContain('ex_incline');
        });

        it('1.3: Fuzzy typo-tolerance matches misspelled exercise names', () => {
            // "pancca" -> Panca Piana Bilanciere / Panca Inclinata
            const typoPanca = createExerciseLibrarySearcher(mockLibrary)('pancca');
            expect(typoPanca.length).toBeGreaterThanOrEqual(1);
            expect(typoPanca.map(r => r.id)).toContain('ex_bench');

            // "squatt" -> Squat con Bilanciere
            const typoSquat = createExerciseLibrarySearcher(mockLibrary)('squatt');
            expect(typoSquat.length).toBeGreaterThanOrEqual(1);
            expect(typoSquat[0].id).toBe('ex_squat');

            // "trazzioni" -> Trazioni alla Sbarra
            const typoTrazioni = createExerciseLibrarySearcher(mockLibrary)('trazzioni');
            expect(typoTrazioni.length).toBeGreaterThanOrEqual(1);
            expect(typoTrazioni[0].id).toBe('ex_pullup');
        });

        it('1.4: Search by Italian primary muscle group matches mapped exercises', () => {
            // "petto" -> Panca Piana, Panca Inclinata
            const chestExercises = createExerciseLibrarySearcher(mockLibrary)('petto');
            expect(chestExercises.length).toBeGreaterThanOrEqual(2);
            expect(chestExercises.map(r => r.id)).toContain('ex_bench');
            expect(chestExercises.map(r => r.id)).toContain('ex_incline');

            // "dorso" -> Trazioni alla Sbarra
            const backExercises = createExerciseLibrarySearcher(mockLibrary)('dorso');
            expect(backExercises.length).toBeGreaterThanOrEqual(1);
            expect(backExercises.map(r => r.id)).toContain('ex_pullup');
        });

        it('1.5: Search by Italian secondary muscle matches exercises', () => {
            // "bicipiti" -> Trazioni alla Sbarra (secondary muscle biceps)
            const bicepsExercises = createExerciseLibrarySearcher(mockLibrary)('bicipiti');
            expect(bicepsExercises.length).toBeGreaterThanOrEqual(1);
            expect(bicepsExercises.map(r => r.id)).toContain('ex_pullup');

            // "tricipiti" -> Panca Piana Bilanciere (secondary muscle triceps)
            const tricepsExercises = createExerciseLibrarySearcher(mockLibrary)('tricipiti');
            expect(tricepsExercises.length).toBeGreaterThanOrEqual(1);
            expect(tricepsExercises.map(r => r.id)).toContain('ex_bench');
        });

        it('1.6: Multi-token combined search matches multiple criteria', () => {
            const results = createExerciseLibrarySearcher(mockLibrary)('petto bilanciere');
            expect(results.length).toBeGreaterThanOrEqual(1);
            expect(results[0].id).toBe('ex_bench');
        });

        it('1.7: Tracking type keyword search finds cardio and time exercises', () => {
            const cardioResults = createExerciseLibrarySearcher(mockLibrary)('cardio');
            expect(cardioResults.length).toBeGreaterThanOrEqual(1);
            expect(cardioResults.map(r => r.id)).toContain('ex_treadmill');

            const timeResults = createExerciseLibrarySearcher(mockLibrary)('plank');
            expect(timeResults.length).toBeGreaterThanOrEqual(1);
            expect(timeResults.map(r => r.id)).toContain('ex_plank');
        });

        it('1.8: Empty query returns full library sorted alphabetically', () => {
            const results = createExerciseLibrarySearcher(mockLibrary)('');
            expect(results.length).toBe(mockLibrary.length);
            const names = results.map(r => r.name);
            const sortedNames = [...names].sort((a, b) => a.localeCompare(b, 'it'));
            expect(names).toEqual(sortedNames);
        });

        it('1.9: Special regex characters do not crash and handle safely', () => {
            expect(() => {
                const results = createExerciseLibrarySearcher(mockLibrary)('.*+?^${}()|[]\\');
                expect(results).toEqual([]);
            }).not.toThrow();
        });

        it('1.10: Empty library or non-array returns empty array safely', () => {
            expect(createExerciseLibrarySearcher([])('panca')).toEqual([]);
            expect(createExerciseLibrarySearcher(null as any)('panca')).toEqual([]);
            expect(createExerciseLibrarySearcher(undefined as any)('panca')).toEqual([]);
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
        it('2.1: Renders input with 16px font-size and Italian sentence case placeholder', () => {
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
            expect(input.style.fontSize).toBe('16px');
            // Dropdown list is not open initially
            expect(container.querySelector('[role="listbox"]')).toBeNull();
        });

        it('2.1a: exposes a stable accessible name for the exercise combobox', () => {
            render(<ExerciseSearchDropdown library={mockLibrary} onSelectExercise={vi.fn()} />);
            expect(screen.getByRole('combobox', { name: 'Cerca esercizio' })).toBeDefined();
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

            // The empty-query list is sorted alphabetically: Corsa, Panca Inclinata, ...
            fireEvent.keyDown(input, { key: 'ArrowDown' });
            fireEvent.keyDown(input, { key: 'ArrowDown' });
            fireEvent.keyDown(input, { key: 'ArrowUp' });
            fireEvent.keyDown(input, { key: 'ArrowDown' });
            fireEvent.keyDown(input, { key: 'Enter' });

            expect(onSelect).toHaveBeenCalledExactlyOnceWith('ex_incline');
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
            input.focus();
            expect(document.activeElement).toBe(input);
            expect(container.querySelector('[role="listbox"]')).not.toBeNull();

            fireEvent.keyDown(input, { key: 'Escape' });
            expect(container.querySelector('[role="listbox"]')).toBeNull();
            expect(document.activeElement).not.toBe(input);
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
        it('2.12: renders a bounded list and reveals the remaining results only on scroll', () => {
            const largeLibrary: ExerciseLibraryItem[] = Array.from({ length: 95 }, (_, index) => ({
                id: `large-${index + 1}`,
                name: index === 94 ? 'Speciale corpo libero' : `Esercizio ${String(index + 1).padStart(3, '0')}`,
                muscles: [],
                setsCount: 3,
                sets: [],
            }));
            const { container } = render(<ExerciseSearchDropdown library={largeLibrary} onSelectExercise={vi.fn()} />);
            const input = container.querySelector('input') as HTMLInputElement;
            expect(container.querySelector('[role="listbox"]')).toBeNull();

            fireEvent.focus(input);
            const listbox = container.querySelector('[role="listbox"]') as HTMLElement;
            expect(listbox.querySelectorAll('[role="option"]')).toHaveLength(40);
            expect(listbox.querySelector('[role="option"]')?.getAttribute('aria-setsize')).toBe('95');

            Object.defineProperties(listbox, {
                scrollTop: { configurable: true, value: 200 },
                clientHeight: { configurable: true, value: 200 },
                scrollHeight: { configurable: true, value: 350 },
            });
            fireEvent.scroll(listbox);
            expect(listbox.querySelectorAll('[role="option"]')).toHaveLength(80);
            fireEvent.scroll(listbox);
            expect(listbox.querySelectorAll('[role="option"]')).toHaveLength(95);

            fireEvent.change(input, { target: { value: 'speciale' } });
            expect(listbox.querySelectorAll('[role="option"]')).toHaveLength(1);
            expect(listbox.textContent).toContain('Speciale corpo libero');
            fireEvent.change(input, { target: { value: '' } });
            expect(listbox.querySelectorAll('[role="option"]')).toHaveLength(40);
        });

        it('2.13: keyboard wrap expands the list before referring to the last option', () => {
            const largeLibrary: ExerciseLibraryItem[] = Array.from({ length: 95 }, (_, index) => ({
                id: `key-${index + 1}`,
                name: `Esercizio ${String(index + 1).padStart(3, '0')}`,
                muscles: [],
                setsCount: 3,
                sets: [],
            }));
            const onSelect = vi.fn();
            const { container } = render(<ExerciseSearchDropdown library={largeLibrary} onSelectExercise={onSelect} />);
            const input = container.querySelector('input') as HTMLInputElement;
            fireEvent.focus(input);
            expect(container.querySelectorAll('[role="option"]')).toHaveLength(40);

            fireEvent.keyDown(input, { key: 'ArrowUp' });
            const activeId = input.getAttribute('aria-activedescendant');
            expect(activeId).toBeTruthy();
            expect(document.getElementById(activeId!)?.getAttribute('role')).toBe('option');
            expect(container.querySelectorAll('[role="option"]')).toHaveLength(95);
            fireEvent.keyDown(input, { key: 'Enter' });
            expect(onSelect).toHaveBeenCalledExactlyOnceWith('key-95');
        });

    });

    // =========================================================================
    // SECTION 3: RoutineEditor Integration Tests (R4)
    // =========================================================================
    describe('3. RoutineEditor Integration with ExerciseSearchDropdown', () => {
        beforeEach(async () => {
            await prepareUnlockedTestArchive('user:test-user-id');
        });

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
                    onUpdateSetPlan={vi.fn()}
                    onUpdateSetPlanField={vi.fn()}
                    onUpdateExerciseMetadata={vi.fn()}
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
            const visibleLabel = screen.getByText('Aggiungi esercizio');
            expect(visibleLabel.tagName).toBe('LABEL');
            expect(visibleLabel.getAttribute('for')).toBe(searchInput.id);
            expect(screen.getByRole('combobox', { name: 'Aggiungi esercizio' })).toBe(searchInput);

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
                    onUpdateSetPlan={vi.fn()}
                    onUpdateSetPlanField={vi.fn()}
                    onUpdateExerciseMetadata={vi.fn()}
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
        beforeEach(async () => {
            await prepareUnlockedTestArchive('user:test-user-id');
        });

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
                        sessionNote: '',
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

            const { container } = renderWithAuthenticatedTestOwner(<TrainingSession />, {
                localWorkout: activeWorkout,
                userData: initialUserData
            });

            // Extra exercise section has search dropdown
            expect(container.textContent).toContain('Aggiungi esercizio');
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
            const blueprint = state.userData?.routines?.find(r => r.id === 'rot_push');
            expect(blueprint?.exercises.length).toBe(1);
            expect(blueprint?.exercises[0].exId).toBe('ex_bench');
        });

        it('4.2: Store snapshot-save preserves ad-hoc exercise IDs in history after flush', async () => {
            const activeWorkout: WorkoutSession = {
                id: 'w_test_2',
                routineId: 'rot_push',
                routineName: 'Scheda Spinta Base',
                date: Logic.getLocalDateString(),
                globalStartTime: Date.now() - 3600000,
                exercises: [
                    {
                        id: 'se_bench',
                        exId: 'ex_bench',
                        sessionNote: '',
                        sets: [{ id: 's_1', kg: '90', reps: '6', done: true }]
                    },
                    {
                        id: 'se_treadmill',
                        exId: 'ex_treadmill',
                        sessionNote: '',
                        sets: [{ id: 's_2', kg: '', reps: '', time: '900', distance: '2.5', speed: '10', done: true }]
                    }
                ]
            };

            const owner = captureSession().owner;
            const initialData = {
                ...emptyUserData,
                library: mockLibrary as any,
                routines: useAppStore.getState().userData?.routines ?? [],
                history: [],
                activeWorkout,
            };
            await initializeLocal(owner, initialData);
            useAppStore.setState({
                localWorkout: activeWorkout,
                userData: initialData,
                dataOwner: owner,
            });

            // Simulate workout finish logic
            const currentWorkout = useAppStore.getState().localWorkout!;
            const finishedWorkout: WorkoutSession = {
                ...currentWorkout,
                globalEndTime: Date.now(),
                globalDurationStr: '01:00:00',
                date: currentWorkout.date
            };

            const pendingSave = useAppStore.getState().saveUserData((prev) => {
                if (!prev) return prev;
                return { ...prev, history: [finishedWorkout, ...(prev.history || [])], activeWorkout: null };
            });
            // Exercise the production flush boundary rather than depending
            // on a debounced cloud timer in this standalone store test.
            await useAppStore.getState().flushPendingSyncs();
            await pendingSave;
            useAppStore.setState({ localWorkout: null });

            const updatedState = useAppStore.getState();
            expect(updatedState.localWorkout).toBeNull();
            expect(updatedState.userData?.history?.length).toBe(1);
            expect(updatedState.userData?.history?.[0]?.exercises.length).toBe(2);
            expect(updatedState.userData?.history?.[0]?.exercises[1]?.exId).toBe('ex_treadmill');

            // Blueprint still unchanged
            const blueprint = updatedState.userData?.routines?.find(r => r.id === 'rot_push');
            expect(blueprint?.exercises.length).toBe(1);
        });
    });
});
