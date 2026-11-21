import { describe, it, expect, beforeEach, vi } from 'vitest';
import { captureSession } from '../../../src/lib/sync/session';
import { render, screen, fireEvent } from '@testing-library/react';
import { renderWithAuthenticatedTestOwner } from '../../setup';
import { useAppStore } from '../../../src/store/useAppStore';
import { SessionExerciseCard } from '../../../src/components/Training/session/SessionExerciseCard';
import SessionExerciseAccordion from '../../../src/components/Training/session/SessionExerciseAccordion';
import TrainingSession from '../../../src/components/Training/TrainingSession';
import { UserDataSchema } from '../../../src/lib/schema';
import { initializeLocal, readLocal } from '../../../src/lib/sync/localRepository';
import type { WorkoutSession } from '../../../src/types';
import { installWorkoutReorderFixture, mockLibrary } from './workoutReorderFixture';

describe('Workout reorder UI, accordion and muscle summary', () => {
    beforeEach(installWorkoutReorderFixture);

    describe('3. SessionExerciseCard UI Controls & Dynamic Muscle Badges', () => {
        const dummyPast = [{ date: '2026-08-15', sets: [{ kg: '90', reps: '6' }], note: 'Buone sensazioni' }];

        it('3.1: Position dropdown renders #N label, opens on click, and calls onMoveToPosition when a target is selected', () => {
            const onMoveToPosition = vi.fn();
            const exItem = { id: 'se_1', exId: 'ex_bench', sets: [{ id: 's1', kg: '80', reps: '8' }], sessionNote: '' };
            const libDef = mockLibrary[0];

            // Render first item of 3
            render(
                <SessionExerciseCard
                    exItem={exItem}
                    exIndex={0}
                    totalExercises={3}
                    libDef={libDef}
                    pastWorkouts={dummyPast}
                    isHistoryOpen={false}
                    isSetupOpen={false}
                    openSpecialMenuId={null}
                    onMoveToPosition={onMoveToPosition}
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

            // Position dropdown button shows current index
            const posBtn = screen.getByRole('button', { name: 'Cambia posizione esercizio' }) as HTMLButtonElement;
            expect(posBtn).not.toBeNull();
            expect(posBtn.textContent?.trim()).toMatch(/#\s*1/);

            // Open dropdown
            fireEvent.click(posBtn);

            // Should show position options for 3 exercises
            const posOptions = screen.getAllByRole('button', { name: /posizione/i });
            // Current position shows checkmark, other positions are clickable targets
            expect(posOptions.length).toBeGreaterThanOrEqual(3);

            // Click "2ª posizione" (index 1) to move exercise from 0 to 1
            const targetBtn = posOptions.find(b => b.textContent?.includes('2ª posizione'));
            expect(targetBtn).not.toBeNull();
            fireEvent.click(targetBtn!);
            expect(onMoveToPosition).toHaveBeenCalledWith(0, 1);
        });


        it('3.3: Accordion omits unknown muscles and restores the real summary when the catalog definition arrives', () => {
            const cardProps = {
                exItem: { id: 'se_deleted', exId: 'ex_deleted_id', sets: [], sessionNote: '' },
                exIndex: 0,
                totalExercises: 1,
                libDef: undefined,
                pastWorkouts: [],
                isHistoryOpen: false,
                isSetupOpen: false,
                openSpecialMenuId: null,
                onToggleHistory: vi.fn(),
                onToggleSetup: vi.fn(),
                onRemoveExercise: vi.fn(),
                onUpdateSetupNote: vi.fn(),
                onUpdateSessionNote: vi.fn(),
                onAddSet: vi.fn(),
                onRemoveSet: vi.fn(),
                onUpdateSet: vi.fn(),
                onAddSpecialSet: vi.fn(),
                onUpdateSpecialSet: vi.fn(),
                onRemoveSpecialSet: vi.fn(),
                onToggleSpecialMenu: vi.fn(),
                onUpdateSetTarget: vi.fn(),
                onUpdateTechnicalStandard: vi.fn(),
            };

            const { container, rerender } = render(
                <SessionExerciseAccordion {...cardProps} isCurrent={false} initiallyExpanded />,
            );
            expect(container.textContent).toContain('Esercizio rimosso');
            expect(container.querySelector('.session-exercise-meta')?.textContent).toBe('0 serie');

            rerender(
                <SessionExerciseAccordion {...cardProps} libDef={mockLibrary[0]} isCurrent={false} initiallyExpanded />,
            );
            expect(container.querySelector('.session-exercise-meta')?.textContent).toBe(
                '0 serie · Primari: Fascio clavicolare (petto alto) · Fascio addominale (petto basso)',
            );
            expect(container.textContent).not.toContain('Esercizio rimosso');
        });

        it('3.4: memoized exercise card updates position controls and callbacks when props change', () => {
            const exItem = { id: 'se_1', exId: 'ex_bench', sets: [], sessionNote: '' };
            const originalMove = vi.fn();
            const latestMove = vi.fn();
            const initialProps = {
                exItem,
                exIndex: 0,
                totalExercises: 1,
                libDef: mockLibrary[0],
                pastWorkouts: [],
                isHistoryOpen: false,
                isSetupOpen: false,
                openSpecialMenuId: null,
                onMoveToPosition: originalMove,
                onToggleHistory: vi.fn(),
                onToggleSetup: vi.fn(),
                onRemoveExercise: vi.fn(),
                onUpdateSetupNote: vi.fn(),
                onUpdateSessionNote: vi.fn(),
                onAddSet: vi.fn(),
                onRemoveSet: vi.fn(),
                onUpdateSet: vi.fn(),
                onAddSpecialSet: vi.fn(),
                onUpdateSpecialSet: vi.fn(),
                onRemoveSpecialSet: vi.fn(),
                onUpdateSetTarget: vi.fn(),
                onUpdateTechnicalStandard: vi.fn(),
                onToggleSpecialMenu: vi.fn()
            };

            const { rerender } = render(<SessionExerciseCard {...initialProps} />);
            const position = screen.getByRole('button', { name: 'Cambia posizione esercizio' });
            expect(position.textContent).toContain('#1');
            expect((position as HTMLButtonElement).disabled).toBe(true);

            rerender(<SessionExerciseCard {...initialProps} totalExercises={3} exIndex={1} onMoveToPosition={latestMove} />);
            expect(position.textContent).toContain('#2');
            expect((position as HTMLButtonElement).disabled).toBe(false);
            fireEvent.click(position);

            expect((screen.getByRole('button', { name: '✓ 2ª posizione' }) as HTMLButtonElement).disabled).toBe(true);
            fireEvent.click(screen.getByRole('button', { name: '3ª posizione' }));
            expect(latestMove).toHaveBeenCalledTimes(1);
            expect(latestMove).toHaveBeenCalledWith(1, 2);
            expect(originalMove).not.toHaveBeenCalled();
        });
    });

    describe('4. TrainingSession View Integration & Accordion Synchronization', () => {
        it('4.1: Moving an exercise updates its position in TrainingSession UI', async () => {
            const owner = captureSession().owner;
            const activeWorkout: WorkoutSession = {
                id: 'ws_active_1',
                routineId: 'rot_1',
                routineName: 'Scheda A',
                date: '2026-08-20',
                globalStartTime: Date.now(),
                exercises: [
                    { id: 'se_1', exId: 'ex_bench', sessionNote: '', sets: [{ id: 's1', kg: '80', reps: '8' }] },
                    { id: 'se_2', exId: 'ex_squat', sessionNote: '', sets: [{ id: 's2', kg: '120', reps: '5' }] }
                ]
            };

            const initialData = UserDataSchema.parse({
                ...useAppStore.getState().userData!,
                library: mockLibrary,
                activeWorkout,
            });
            await initializeLocal(owner, initialData);
            expect((await readLocal(owner))?.data.activeWorkout?.id).toBe(activeWorkout.id);
            const { container } = renderWithAuthenticatedTestOwner(<TrainingSession />, {
                localWorkout: activeWorkout,
                userData: initialData,
                dataOwner: owner,
            });

            // Exercise headings in order
            const headings = container.querySelectorAll('h2');
            expect(headings[0].textContent).toBe('Panca piana con bilanciere');
            expect(headings[1].textContent).toBe('Squat con bilanciere');

            // Expand first exercise, then use its position control.
            fireEvent.click(screen.getByRole('button', { name: /Panca piana con bilanciere/i }));
            const posBtns = screen.getAllByRole('button', { name: 'Cambia posizione esercizio' });
            fireEvent.click(posBtns[0]); // open dropdown for exercise #1
            const posOption2 = screen.getAllByRole('button', { name: /2ª posizione/i })[0];
            fireEvent.click(posOption2);

            // Workout state in store should now have Squat first, Bench second
            const state = useAppStore.getState();
            expect(state.localWorkout?.exercises[0].id).toBe('se_2');
            expect(state.localWorkout?.exercises[1].id).toBe('se_1');
        });

        it('4.2: Accordion panel (Storico/Setup) index synchronizes when exercise is moved', async () => {
            const owner = captureSession().owner;
            const activeWorkout: WorkoutSession = {
                id: 'ws_active_1',
                routineId: 'rot_1',
                routineName: 'Scheda A',
                date: '2026-08-20',
                globalStartTime: Date.now(),
                exercises: [
                    { id: 'se_1', exId: 'ex_bench', sessionNote: '', sets: [{ id: 's1', kg: '80', reps: '8' }] },
                    { id: 'se_2', exId: 'ex_squat', sessionNote: '', sets: [{ id: 's2', kg: '120', reps: '5' }] }
                ]
            };

            const initialData = UserDataSchema.parse({
                ...useAppStore.getState().userData!,
                library: mockLibrary,
                activeWorkout,
            });
            await initializeLocal(owner, initialData);
            expect((await readLocal(owner))?.data.activeWorkout?.id).toBe(activeWorkout.id);
            const { container } = renderWithAuthenticatedTestOwner(<TrainingSession />, {
                localWorkout: activeWorkout,
                userData: initialData,
                dataOwner: owner,
            });

            // Expand first exercise, then open Setup on Bench at index 0.
            fireEvent.click(screen.getByRole('button', { name: /Panca piana con bilanciere/i }));
            const setupBtns = screen.getAllByRole('button', { name: /Setup/i });
            fireEvent.click(setupBtns[0]);

            // Setup input should be visible for ex_bench
            const setupInput = container.querySelector('#setup-se_1') as HTMLInputElement;
            expect(setupInput).not.toBeNull();
            expect(setupInput.defaultValue).toBe('Gomiti a 45 gradi');

            // Now move index 0 to position 2 via dropdown
            const posBtns2 = screen.getAllByRole('button', { name: 'Cambia posizione esercizio' });
            fireEvent.click(posBtns2[0]); // open dropdown for exercise #1
            const posOption2b = screen.getAllByRole('button', { name: /2ª posizione/i })[0];
            fireEvent.click(posOption2b);

            // After move, Setup panel should remain open on ex_bench (now at index 1)
            const setupInputAfter = container.querySelector('#setup-se_1') as HTMLInputElement;
            expect(setupInputAfter).not.toBeNull();
            expect(setupInputAfter.defaultValue).toBe('Gomiti a 45 gradi');

            // Setup for ex_squat should NOT be open
            const squatSetupInput = container.querySelector('#setup-ex_squat');
            expect(squatSetupInput).toBeNull();
        });
    });
});
