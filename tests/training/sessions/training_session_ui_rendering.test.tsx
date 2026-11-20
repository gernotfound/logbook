import React from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import SessionExerciseCard from '../../../src/components/Training/session/SessionExerciseCard';
import SessionExerciseAccordion from '../../../src/components/Training/session/SessionExerciseAccordion';
import SessionSetRow from '../../../src/components/Training/session/SessionSetRow';
import TrainingSession from '../../../src/components/Training/TrainingSession';
import { renderWithAuthenticatedTestOwner, emptyUserData } from '../../setup';
import type { WorkoutSession } from '../../../src/types';
import { setupTrainingSessionUiFixture, mockLibrary } from './trainingSessionUiFixture';

describe('exercise rendering and controls', () => {
    beforeEach(setupTrainingSessionUiFixture);

    describe('R1: Graphic Restyling of Exercises and Sets', () => {
        it('R1.1: Exercises container in TrainingSession does NOT have .card gray background class', () => {
            const activeWorkout: WorkoutSession = {
                id: 'sess_1',
                routineId: 'routine_1',
                routineName: 'Scheda Petto',
                date: '2026-08-20',
                globalStartTime: Date.now(),
                exercises: [
                    {
                        exId: 'ex_bench',
                        sets: [{ id: 's1', kg: '80', reps: '10' }],
                        sessionNote: ''
                    }
                ]
            };

            renderWithAuthenticatedTestOwner(<TrainingSession />, {
                localWorkout: activeWorkout,
                userData: {
                    ...emptyUserData,
                    library: mockLibrary,
                    routines: [{ id: 'routine_1', name: 'Scheda Petto', exercises: [{ exId: 'ex_bench', setsCount: 3 }] }]
                }
            });

            expect(screen.getByText('Scheda Petto')).toBeDefined();
            const exerciseList = document.querySelector('.session-exercise-list');
            expect(exerciseList).not.toBeNull();
            expect(exerciseList?.classList.contains('card')).toBe(false);
            expect(exerciseList?.querySelector('.session-exercise-shell')).not.toBeNull();
        });

        it('R1.2: SessionSetRow exposes the semantic primary border token (jsdom structural check)', () => {
            const setObj = { id: 's1', kg: '80', reps: '10' };

            const { container } = render(
                <SessionSetRow
                    set={setObj}
                    sIndex={0}
                    exIndex={0}
                    trackingType="weight_reps"
                    isOpenMenu={false}
                    onToggleMenu={() => {}}
                    onRemoveSet={() => {}}
                    onUpdateSet={() => {}}
                    onAddSpecialSet={() => {}}
                    onUpdateSpecialSet={() => {}}
                    onRemoveSpecialSet={() => {}}
                    onUpdateSetTarget={() => {}}
                />
            );

            const row = container.querySelector('.set-row');
            expect(row).not.toBeNull();
            expect((row as HTMLElement).style.border).toContain('var(--primary-color)');
        });

    });

    it('R1.3: advanced techniques are an ordered queue without a generic segment control', () => {
        const { container } = render(
            <SessionSetRow
                set={{ id: 's-tech', kg: '100', reps: '8', technique: 'dropset', segments: [
                    { id: 'seg1', kg: '', reps: '', technique: 'dropset' },
                    { id: 'seg2', kg: '', reps: '', technique: 'dropset' },
                    { id: 'seg3', kg: '', reps: '', technique: 'rest_pause' },
                ] }}
                sIndex={0}
                exIndex={0}
                trackingType="weight_reps"
                isOpenMenu={false}
                onToggleMenu={() => {}}
                onRemoveSet={() => {}}
                onUpdateSet={() => {}}
                onAddSpecialSet={() => {}}
                onUpdateSpecialSet={() => {}}
                onRemoveSpecialSet={() => {}}
                onUpdateSetTarget={() => {}}
            />
        );
        expect(screen.getByText('↳ Dropset 1')).toBeDefined();
        expect(screen.getByText('↳ Dropset 2')).toBeDefined();
        expect(screen.getByText('↳ Rest-pause 1')).toBeDefined();
        expect(screen.queryByText('+ Segmento')).toBeNull();
        expect(container.textContent?.toLocaleLowerCase('it')).not.toContain('segmento');
    });

    it('associa le cinque etichette cardio ai rispettivi campi', () => {
        render(
            <SessionExerciseCard
                exItem={{ id: 'cardio-instance', exId: 'ex_treadmill', sessionNote: '', sets: [
                    { id: 'cardio-set-1', kg: '', reps: '', time: '', distance: '', speed: '', incline: '', kcal: '' }
                ] }}
                exIndex={0}
                libDef={{ id: 'ex_treadmill', name: 'Tapis Roulant', trackingType: 'cardio' }}
                pastWorkouts={[]}
                isHistoryOpen={false}
                isSetupOpen={false}
                openSpecialMenuId={null}
                onToggleHistory={vi.fn()}
                onToggleSetup={vi.fn()}
                onRemoveExercise={vi.fn()}
                onUpdateSetupNote={vi.fn()}
                onUpdateSessionNote={vi.fn()}
                onUpdateTechnicalStandard={vi.fn()}
                onAddSet={vi.fn()}
                onRemoveSet={vi.fn()}
                onUpdateSet={vi.fn()}
                onAddSpecialSet={vi.fn()}
                onUpdateSpecialSet={vi.fn()}
                onRemoveSpecialSet={vi.fn()}
                onUpdateSetTarget={vi.fn()}
                onToggleSpecialMenu={vi.fn()}
            />
        );

        for (const label of ['Durata (min)', 'Distanza (km)', 'Velocità media', 'Inclinazione (%)', 'Kcal stimate']) {
            expect(screen.getByRole('textbox', { name: label })).toBeDefined();
        }
    });

    it('isola ID e associazioni dei campi di due istanze senza ID persistente', () => {
        const props = {
            exItem: { exId: 'ex_treadmill', sessionNote: '', sets: [{ id: 'set-one', kg: '', reps: '' }] },
            exIndex: 0,
            libDef: { id: 'ex_treadmill', name: 'Tapis Roulant', trackingType: 'cardio' },
            pastWorkouts: [],
            isHistoryOpen: false,
            isSetupOpen: false,
            openSpecialMenuId: null,
            onToggleHistory: vi.fn(),
            onToggleSetup: vi.fn(),
            onRemoveExercise: vi.fn(),
            onUpdateSetupNote: vi.fn(),
            onUpdateSessionNote: vi.fn(),
            onUpdateTechnicalStandard: vi.fn(),
            onAddSet: vi.fn(),
            onRemoveSet: vi.fn(),
            onUpdateSet: vi.fn(),
            onAddSpecialSet: vi.fn(),
            onUpdateSpecialSet: vi.fn(),
            onRemoveSpecialSet: vi.fn(),
            onUpdateSetTarget: vi.fn(),
            onToggleSpecialMenu: vi.fn(),
        };
        const { container } = render(
            <>
                <SessionExerciseAccordion {...props} isCurrent initiallyExpanded />
                <SessionExerciseAccordion
                    {...props}
                    exItem={{ ...props.exItem, sets: [{ id: 'set-two', kg: '', reps: '' }] }}
                    exIndex={1}
                    isCurrent={false}
                    initiallyExpanded
                />
            </>
        );

        const shells = [...container.querySelectorAll('.session-exercise-shell')];
        expect(shells).toHaveLength(2);
        for (const [index, shell] of shells.entries()) {
            const identity = `ex_treadmill_${index}`;
            const summary = shell.querySelector('.session-exercise-summary');
            const body = shell.querySelector('.session-exercise-shell-body');
            expect(summary?.getAttribute('aria-controls')).toBe(`session-exercise-body-${identity}`);
            expect(body?.id).toBe(`session-exercise-body-${identity}`);
            for (const field of ['time', 'distance', 'speed', 'incline', 'kcal']) {
                const id = `cardio-${field}-${identity}-${index === 0 ? 'set-one' : 'set-two'}`;
                const input = shell.querySelector(`input[id="${id}"]`);
                const label = shell.querySelector(`label[for="${id}"]`) as HTMLLabelElement | null;
                expect(input).not.toBeNull();
                expect(label?.control).toBe(input);
                expect(container.querySelectorAll(`[id="${id}"]`)).toHaveLength(1);
            }
            const noteId = `session-note-${identity}`;
            expect(shell.querySelector(`textarea[id="${noteId}"]`)).not.toBeNull();
            expect(container.querySelectorAll(`[id="${noteId}"]`)).toHaveLength(1);
        }
    });
});
