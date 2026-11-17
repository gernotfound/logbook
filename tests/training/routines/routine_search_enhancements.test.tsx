import React from 'react';
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { act, fireEvent, renderHook } from '@testing-library/react';
import { renderWithProviders, emptyUserData, idbStore } from '../../setup';
import { useAppStore } from '../../../src/store/useAppStore';
import { captureSession } from '../../../src/lib/sync/session';
import { initializeLocal, readLocal } from '../../../src/lib/sync/localRepository';
import { prepareUnlockedTestArchive } from '../../secureVaultFixture';
import { RoutineEditor } from '../../../src/components/Training/routines/RoutineEditor';
import type { Exercise } from '../../../src/types';
import { useDialogStore } from '../../../src/store/useDialogStore';
import { useTrainingRoutines } from '../../../src/hooks/useTrainingRoutines';

describe('Routine exercise search', () => {
    describe('Feature coverage', () => {
    beforeEach(async () => {
        window.localStorage.clear();
        localStorage.setItem(`logbook:v2:${captureSession().owner}:health-consent-generation`, '1');
        useAppStore.getState().resetStore();
        useAppStore.setState({ dataOwner: captureSession().owner });
        vi.clearAllMocks();
    });

    afterEach(() => {
        window.localStorage.clear();
        useAppStore.getState().resetStore();
        vi.restoreAllMocks();
    });

        describe('R4: Ricerca Intelligente Aggiunta Scheda', () => {
            it('T1.4.1: RoutineEditor renders exercise list and triggers onAddExercise when selecting from library', () => {
                const library: Exercise[] = [
                    { id: 'ex_dip', name: 'Dip alle Parallele', setsCount: 3, sets: [] }
                ];
                const onAddExercise = vi.fn();

                const { container } = renderWithProviders(
                    <RoutineEditor
                        routineName="Scheda Spinta"
                        setRoutineName={vi.fn()}
                        editingRoutineId={null}
                        routineExercises={[]}
                        library={library}
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

                const searchInput = (container.querySelector('input[placeholder="🔍 Cerca esercizio da aggiungere..."]') ||
                    container.querySelector('input[role="combobox"]')) as HTMLInputElement;
                expect(searchInput).not.toBeNull();
                act(() => {
                    fireEvent.focus(searchInput);
                    fireEvent.click(searchInput);
                });
                const dropdownItem = container.querySelector('.exercise-dropdown-item') as HTMLElement;
                expect(dropdownItem).not.toBeNull();
                act(() => {
                    fireEvent.click(dropdownItem);
                });
                expect(onAddExercise).toHaveBeenCalledWith('ex_dip');
            });

            it('T1.4.4: RoutineEditor renders an already assigned exercise and its count', () => {
                const routineExercises = [
                    { exId: 'ex1', setsCount: 4, minReps: 8, maxReps: 12 }
                ];
                const library: Exercise[] = [
                    { id: 'ex1', name: 'Panca Piana', setsCount: 3, sets: [] }
                ];

                const { container } = renderWithProviders(
                    <RoutineEditor
                        routineName="Test Routine"
                        setRoutineName={vi.fn()}
                        editingRoutineId="r1"
                        routineExercises={routineExercises}
                        library={library}
                        editMuscles={['chest']}
                        editSecMuscles={['triceps']}
                        onAddExercise={vi.fn()}
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

                expect(container.textContent).toContain('Esercizi nella scheda (1)');
                expect(container.textContent).toContain('Panca Piana');
            });

            it('T1.4.5: RoutineEditor presents assigned exercises in input order', () => {
                const routineExercises = [
                    { exId: 'ex1', setsCount: 3 },
                    { exId: 'ex2', setsCount: 4 },
                    { exId: 'ex3', setsCount: 3 }
                ];
                const library: Exercise[] = [
                    { id: 'ex1', name: 'Pullup', setsCount: 3, sets: [] },
                    { id: 'ex2', name: 'Rematore', setsCount: 3, sets: [] },
                    { id: 'ex3', name: 'Curl', setsCount: 3, sets: [] }
                ];

                const { container } = renderWithProviders(
                    <RoutineEditor
                        routineName="Pull Day"
                        setRoutineName={vi.fn()}
                        editingRoutineId={null}
                        routineExercises={routineExercises}
                        library={library}
                        editMuscles={[]}
                        editSecMuscles={[]}
                        onAddExercise={vi.fn()}
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

                expect(container.textContent).toContain('Esercizi nella scheda (3)');
                expect(container.textContent).toContain('1. Pullup');
                expect(container.textContent).toContain('2. Rematore');
                expect(container.textContent).toContain('3. Curl');
            });
        });
    });

    describe('Boundaries and corner cases', () => {
    beforeEach(async () => {
        window.localStorage.clear();
        localStorage.setItem(`logbook:v2:${captureSession().owner}:health-consent-generation`, '1');
        useAppStore.getState().resetStore();
        useAppStore.setState({ dataOwner: captureSession().owner });
        vi.clearAllMocks();
    });

    afterEach(() => {
        window.localStorage.clear();
        useAppStore.getState().resetStore();
        vi.restoreAllMocks();
    });

        describe('R4 Boundaries (Routine Editor Search & Add Edge Cases)', () => {
            it('T2.4.1: Empty library in RoutineEditor displays empty message without crashing', () => {
                const { container } = renderWithProviders(
                    <RoutineEditor
                        routineName="Nuova Scheda"
                        setRoutineName={vi.fn()}
                        editingRoutineId={null}
                        routineExercises={[]}
                        library={[]}
                        editMuscles={[]}
                        editSecMuscles={[]}
                        onAddExercise={vi.fn()}
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

                expect(container.textContent).toContain('Nessun esercizio presente');
            });

            it('T2.4.3: Adding the same library exercise multiple times to a routine is permitted', () => {
                const routineExercises = [
                    { exId: 'ex_pullup', setsCount: 3 },
                    { exId: 'ex_pullup', setsCount: 4 }
                ];
                const library: Exercise[] = [
                    { id: 'ex_pullup', name: 'Trazioni', setsCount: 3, sets: [] }
                ];

                const { container } = renderWithProviders(
                    <RoutineEditor
                        routineName="Dorso"
                        setRoutineName={vi.fn()}
                        editingRoutineId={null}
                        routineExercises={routineExercises}
                        library={library}
                        editMuscles={[]}
                        editSecMuscles={[]}
                        onAddExercise={vi.fn()}
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

                expect(container.textContent).toContain('Esercizi nella scheda (2)');
            });

            it('T2.4.3b: repeated routine exercise identities fail validation without locking the local archive', async () => {
                await prepareUnlockedTestArchive('user:test-user-id');
                const owner = captureSession().owner;
                const initialData = { ...emptyUserData, routines: [] };
                delete idbStore['logbook:v2:' + owner];
                await initializeLocal(owner, initialData);
                useAppStore.setState({ userData: initialData, dataOwner: owner });

                const { result } = renderHook(() => useTrainingRoutines());
                act(() => {
                    result.current.setRoutineName('Routine test');
                    result.current.handleAddExerciseToRoutine('ex_pullup');
                    result.current.handleAddExerciseToRoutine('ex_pullup');
                });
                expect(result.current.routineExercises).toHaveLength(2);

                let saved: boolean | undefined;
                await act(async () => {
                    saved = await result.current.handleSave();
                });

                expect(saved).toBe(false);
                expect(useDialogStore.getState().showAlert).toHaveBeenCalledWith(
                    expect.stringContaining('presente due volte'),
                );
                expect(result.current.routineExercises).toHaveLength(2);
                expect(useAppStore.getState().localPersistenceBlocked).toBe(false);
                expect((await readLocal(owner))?.data.routines).toEqual([]);
                expect(idbStore['logbook:v2:' + owner]).toMatch(/^tlb-sealed:v1:/);
            });

            it('T2.4.4: Long routine name (100+ chars) renders without breaking layout', () => {
                const longName = 'Scheda Ipertrofia ad Alto Volume con Focus Pettorali, Deltoidi Laterali e Braccia - Versione 2.0 Avanzata';
                const setRoutineName = vi.fn();

                const { container } = renderWithProviders(
                    <RoutineEditor
                        routineName={longName}
                        setRoutineName={setRoutineName}
                        editingRoutineId="r_long"
                        routineExercises={[]}
                        library={[]}
                        editMuscles={[]}
                        editSecMuscles={[]}
                        onAddExercise={vi.fn()}
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

                const input = container.querySelector('input[type="text"]') as HTMLInputElement;
                expect(input.value).toBe(longName);
            });

            it('T2.4.5: Removing an exercise from RoutineEditor requires confirmation before onRemove', async () => {
                const onRemoveExercise = vi.fn();
                const routineExercises = [{ exId: 'ex1', setsCount: 3 }];
                const library: Exercise[] = [{ id: 'ex1', name: 'Squat', setsCount: 3, sets: [] }];

                const { container } = renderWithProviders(
                    <RoutineEditor
                        routineName="Gambe"
                        setRoutineName={vi.fn()}
                        editingRoutineId="r1"
                        routineExercises={routineExercises}
                        library={library}
                        editMuscles={[]}
                        editSecMuscles={[]}
                        onAddExercise={vi.fn()}
                        onMoveExercise={vi.fn()}
                        onRemoveExercise={onRemoveExercise}
                        onUpdateSetsCount={vi.fn()}
                        onUpdateReps={vi.fn()}
                        onUpdateSetPlan={vi.fn()}
                        onUpdateSetPlanField={vi.fn()}
                        onUpdateExerciseMetadata={vi.fn()}
                        onSave={vi.fn()}
                        onCancel={vi.fn()}
                    />
                );

                const deleteBtn = container.querySelector('button[aria-label="Rimuovi esercizio"]');
                expect(deleteBtn).not.toBeNull();

                const showConfirm = vi.mocked(useDialogStore.getState().showConfirm);
                showConfirm.mockResolvedValueOnce(false).mockResolvedValueOnce(true);

                await act(async () => {
                    fireEvent.click(deleteBtn!);
                    await Promise.resolve();
                });
                expect(showConfirm).toHaveBeenCalledWith(
                    expect.stringContaining('Squat'),
                    'Rimuovi esercizio',
                );
                expect(onRemoveExercise).not.toHaveBeenCalled();

                await act(async () => {
                    fireEvent.click(deleteBtn!);
                    await Promise.resolve();
                });
                expect(onRemoveExercise).toHaveBeenCalledWith(0);
            });
        });
    });
});
