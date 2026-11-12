import React from 'react';
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { act } from '@testing-library/react';
import { renderWithAuthenticatedTestOwner, renderWithProviders, emptyUserData } from '../../setup';
import { useAppStore } from '../../../src/store/useAppStore';
import { captureSession } from '../../../src/lib/sync/session';
import { prepareUnlockedTestArchive } from '../../secureVaultFixture';
import TrainingSession from '../../../src/components/Training/TrainingSession';
import SessionExerciseCard from '../../../src/components/Training/session/SessionExerciseCard';
import type { WorkoutSession, Exercise } from '../../../src/types';
import { SessionExerciseSchema } from '../../../src/lib/schema';

describe('Live session exercise library updates', () => {
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

        describe('R3: Sincronizzazione in Tempo Reale Esercizi', () => {
            beforeEach(async () => {
                await prepareUnlockedTestArchive('user:test-user-id');
            });

            it('T1.3.1: TrainingSession resolves exercise name dynamically from userData.library via exId', () => {
                const mockLibrary: Exercise[] = [
                    { id: 'ex_bench', name: 'Panca Piana Bilanciere', setsCount: 3, sets: [] }
                ];
                const activeSession: WorkoutSession = {
                    globalStartTime: 1,
                    id: 'w1',
                    routineName: 'Push A',
                    exercises: [{ exId: 'ex_bench', sessionNote: '', sets: [{ id: 's1', kg: '80', reps: '8' }] }]
                };

                const { container } = renderWithAuthenticatedTestOwner(<TrainingSession />, {
                    userData: { ...emptyUserData, library: mockLibrary } as any,
                    localWorkout: activeSession
                });

                expect(container.textContent).toContain('Panca Piana Bilanciere');
            });

            it('T1.3.2: Updating library exercise name in store immediately reflects in active workout UI', () => {
                const initialLibrary: Exercise[] = [
                    { id: 'ex_squat', name: 'Squat Classico', setsCount: 3, sets: [] }
                ];
                const activeSession: WorkoutSession = {
                    globalStartTime: 1,
                    id: 'w1',
                    routineName: 'Legs A',
                    exercises: [{ exId: 'ex_squat', sessionNote: '', sets: [{ id: 's1', kg: '100', reps: '5' }] }]
                };

                const { container } = renderWithAuthenticatedTestOwner(<TrainingSession />, {
                    userData: { ...emptyUserData, library: initialLibrary } as any,
                    localWorkout: activeSession
                });

                expect(container.textContent).toContain('Squat Classico');

                // Update library in store
                act(() => {
                    useAppStore.setState({
                        userData: {
                            ...emptyUserData,
                            library: [{ id: 'ex_squat', name: 'Squat con Bilanciere Olimpico', setsCount: 3, sets: [] }]
                        } as any
                    });
                });

                expect(container.textContent).toContain('Squat con Bilanciere Olimpico');
                expect(container.textContent).not.toContain('Squat Classico');
            });

            it('T1.3.3: SessionExerciseCard opens with notes from the supplied library definition', () => {
                const libDef = { id: 'ex_lat', name: 'Lat Machine', notes: 'Altezza cuscino 3, presa prona' };
                const exItem = { exId: 'ex_lat', sessionNote: '', sets: [] };

                const { container } = renderWithProviders(
                    <SessionExerciseCard
                        exItem={exItem}
                        exIndex={0}
                        libDef={libDef}
                        pastWorkouts={[]}
                        isHistoryOpen={false}
                        isSetupOpen={true}
                        openSpecialMenuId={null}
                        onToggleHistory={vi.fn()}
                        onToggleSetup={vi.fn()}
                        onRemoveExercise={vi.fn()}
                        onUpdateSetupNote={vi.fn()}
                        onUpdateSessionNote={vi.fn()}
                        onAddSet={vi.fn()}
                        onRemoveSet={vi.fn()}
                        onUpdateSet={vi.fn()}
                        onAddSpecialSet={vi.fn()}
                        onUpdateSpecialSet={vi.fn()}
                        onRemoveSpecialSet={vi.fn()}
                        onToggleSpecialMenu={vi.fn()}
                    onUpdateSetTarget={vi.fn()}
                    onUpdateTechnicalStandard={vi.fn()}
                    />
                );

                const setupInput = container.querySelector('#setup-ex_lat_0') as HTMLInputElement;
                expect(setupInput).not.toBeNull();
                expect(setupInput.defaultValue).toBe('Altezza cuscino 3, presa prona');
                expect(container.textContent).toContain('Note esercizio');
                expect(container.textContent).not.toContain('Setup e standard tecnico');
                expect(container.textContent).not.toContain('Se cambia rispetto allo storico');
            });

            it('T1.3.4: Deleted or missing library item gracefully falls back to "Esercizio rimosso"', () => {
                const exItem = { exId: 'non_existent_ex_id', sessionNote: '', sets: [] };

                const { container } = renderWithProviders(
                    <SessionExerciseCard
                        exItem={exItem}
                        exIndex={0}
                        libDef={undefined}
                        pastWorkouts={[]}
                        isHistoryOpen={false}
                        isSetupOpen={false}
                        openSpecialMenuId={null}
                        onToggleHistory={vi.fn()}
                        onToggleSetup={vi.fn()}
                        onRemoveExercise={vi.fn()}
                        onUpdateSetupNote={vi.fn()}
                        onUpdateSessionNote={vi.fn()}
                        onAddSet={vi.fn()}
                        onRemoveSet={vi.fn()}
                        onUpdateSet={vi.fn()}
                        onAddSpecialSet={vi.fn()}
                        onUpdateSpecialSet={vi.fn()}
                        onRemoveSpecialSet={vi.fn()}
                        onToggleSpecialMenu={vi.fn()}
                    onUpdateSetTarget={vi.fn()}
                    onUpdateTechnicalStandard={vi.fn()}
                    />
                );

                expect(container.textContent).toContain('Esercizio rimosso');
            });

            it('T1.3.5: Multiple exercises in workout each independently resolve from library mapping', () => {
                const mockLibrary: Exercise[] = [
                    { id: 'ex1', name: 'Trazioni alla Sbarra', setsCount: 3, sets: [] },
                    { id: 'ex2', name: 'Military Press', setsCount: 3, sets: [] }
                ];
                const activeSession: WorkoutSession = {
                    globalStartTime: 1,
                    id: 'w1',
                    routineName: 'Upper Day',
                    exercises: [
                        { exId: 'ex1', sessionNote: '', sets: [] },
                        { exId: 'ex2', sessionNote: '', sets: [] }
                    ]
                };

                const { container } = renderWithAuthenticatedTestOwner(<TrainingSession />, {
                    userData: { ...emptyUserData, library: mockLibrary } as any,
                    localWorkout: activeSession
                });

                expect(container.textContent).toContain('Trazioni alla Sbarra');
                expect(container.textContent).toContain('Military Press');
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

        describe('R3 Boundaries (Library Synchronization Edge Cases)', () => {
            beforeEach(async () => {
                await prepareUnlockedTestArchive('user:test-user-id');
            });

            it('T2.3.1: Library item with special characters and quotes renders safely without DOM break', () => {
                const specialLib: Exercise[] = [
                    { id: 'ex_special', name: 'Curl 45° con Manubri & Bilanciere (A/B) "Pro"', setsCount: 3, sets: [] }
                ];
                const activeSession: WorkoutSession = {
                    globalStartTime: 1,
                    id: 'w1',
                    exercises: [{ exId: 'ex_special', sessionNote: '', sets: [] }]
                };

                const { container } = renderWithAuthenticatedTestOwner(<TrainingSession />, {
                    userData: { ...emptyUserData, library: specialLib } as any,
                    localWorkout: activeSession
                });

                expect(container.textContent).toContain('Curl 45° con Manubri & Bilanciere (A/B) "Pro"');
            });

            it('T2.3.2: Library item with undefined notes and muscles renders smoothly', () => {
                const sparseLib: Exercise[] = [
                    { id: 'ex_sparse', name: 'Calf Raise', setsCount: 4, sets: [] }
                ];
                const activeSession: WorkoutSession = {
                    globalStartTime: 1,
                    id: 'w1',
                    exercises: [{ exId: 'ex_sparse', sessionNote: '', sets: [] }]
                };

                const { container } = renderWithAuthenticatedTestOwner(<TrainingSession />, {
                    userData: { ...emptyUserData, library: sparseLib } as any,
                    localWorkout: activeSession
                });

                expect(container.textContent).toContain('Calf Raise');
            });

            it('T2.3.3: Bulk library rename simultaneously updates all corresponding active session cards', () => {
                const lib1: Exercise[] = [
                    { id: 'ex1', name: 'Panca 1', setsCount: 3, sets: [] },
                    { id: 'ex2', name: 'Squat 1', setsCount: 3, sets: [] }
                ];
                const activeSession: WorkoutSession = {
                    globalStartTime: 1,
                    id: 'w1',
                    exercises: [
                        { exId: 'ex1', sessionNote: '', sets: [] },
                        { exId: 'ex2', sessionNote: '', sets: [] }
                    ]
                };

                const { container } = renderWithAuthenticatedTestOwner(<TrainingSession />, {
                    userData: { ...emptyUserData, library: lib1 } as any,
                    localWorkout: activeSession
                });

                expect(container.textContent).toContain('Panca 1');
                expect(container.textContent).toContain('Squat 1');

                act(() => {
                    useAppStore.setState({
                        userData: {
                            ...emptyUserData,
                            library: [
                                { id: 'ex1', name: 'Panca Modificata', setsCount: 3, sets: [] },
                                { id: 'ex2', name: 'Squat Modificato', setsCount: 3, sets: [] }
                            ]
                        } as any
                    });
                });

                expect(container.textContent).toContain('Panca Modificata');
                expect(container.textContent).toContain('Squat Modificato');
            });

            it('T2.3.4: Library lookup resolves exact ID match in exercise card title even when IDs share prefixes', () => {
                const prefixLib: Exercise[] = [
                    { id: 'ex1', name: 'Exercise One', setsCount: 3, sets: [] },
                    { id: 'ex10', name: 'Exercise Ten', setsCount: 3, sets: [] }
                ];
                const activeSession: WorkoutSession = {
                    globalStartTime: 1,
                    id: 'w1',
                    exercises: [{ exId: 'ex10', sessionNote: '', sets: [] }]
                };

                const { container } = renderWithAuthenticatedTestOwner(<TrainingSession />, {
                    userData: { ...emptyUserData, library: prefixLib } as any,
                    localWorkout: activeSession
                });

                const exerciseHeadings = Array.from(container.querySelectorAll('h2') as NodeListOf<HTMLHeadingElement>).map(h => h.textContent);
                expect(exerciseHeadings).toContain('Exercise Ten');
                expect(exerciseHeadings).not.toContain('Exercise One');
            });

            it('T2.3.5: SessionExerciseSchema sanitizes malformed exercise set data', () => {
                const corruptedExercise = {
                    exId: 'ex1',
                    sessionNote: 12345, // should convert to string
                    sets: [
                        { id: 's1', kg: 80, reps: 10 } // numbers convert to string
                    ]
                };

                const parsed = SessionExerciseSchema.parse(corruptedExercise);
                expect(parsed.sessionNote).toBe('12345');
                expect(parsed.sets[0].kg).toBe('80');
                expect(parsed.sets[0].reps).toBe('10');
            });
        });
    });
});
