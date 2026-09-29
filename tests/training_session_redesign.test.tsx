import React from 'react';
import { act, fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import SessionExerciseAccordion from '../src/components/Training/session/SessionExerciseAccordion';
import SessionExerciseCard from '../src/components/Training/session/SessionExerciseCard';
import SessionSetRow from '../src/components/Training/session/SessionSetRow';
import { getRoutineDurationEstimate } from '../src/components/Training/session/sessionDurationEstimate';
import { useDialogStore } from '../src/store/useDialogStore';
import type { WorkoutSession } from '../src/types';
import { sessionSetHasMeaningfulData } from '../src/lib/workoutSetData';

const baseExerciseProps = {
    exItem: {
        id: 'session-exercise-1',
        exId: 'bench',
        minReps: 6,
        maxReps: 8,
        sets: [
            { id: 'set-1', kg: '', reps: '' },
            { id: 'set-2', kg: '', reps: '' },
        ],
        sessionNote: '',
    },
    exIndex: 0,
    totalExercises: 2,
    libDef: {
        id: 'bench',
        name: 'Panca piana',
        setsCount: 3,
        trackingType: 'weight_reps' as const,
    },
    pastWorkouts: [],
    isHistoryOpen: false,
    isSetupOpen: false,
    openSpecialMenuId: null,
    onMoveExercise: vi.fn(),
    onMoveToPosition: vi.fn(),
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
    onRemoveLastSet: vi.fn(),
};

function completedWorkout(
    routineId: string,
    minutes: number,
    timestamp: number,
): WorkoutSession {
    return {
        id: `workout-${routineId}-${timestamp}`,
        routineId,
        globalEndTime: timestamp,
        globalDurationStr: `00:${String(minutes).padStart(2, '0')}:00`,
        exercises: [],
    };
}

describe('training session redesign', () => {
    it('keeps exercise cards collapsed initially and exposes real expansion state', () => {
        render(
            <SessionExerciseAccordion
                {...baseExerciseProps}
                isCurrent
                onActivate={vi.fn()}
            />,
        );

        const summary = screen.getByRole('button', { name: /Panca piana/i });
        expect(summary.getAttribute('aria-expanded')).toBe('false');
        expect(screen.getByText('2 serie · 6–8')).toBeDefined();

        fireEvent.click(summary);
        expect(summary.getAttribute('aria-expanded')).toBe('true');
    });

    it('shows a previous note only when the immediately preceding session has one', () => {
        const { rerender } = render(
            <SessionExerciseCard
                {...baseExerciseProps}
                pastWorkouts={[
                    { date: '2026-09-30', sets: [], note: '   ' },
                    { date: '2026-09-28', sets: [], note: 'Nota più vecchia' },
                ]}
            />,
        );

        expect(screen.queryByText(/Nota dall’ultima sessione:/i)).toBeNull();
        expect(screen.queryByText('Nota più vecchia')).toBeNull();

        rerender(
            <SessionExerciseCard
                {...baseExerciseProps}
                pastWorkouts={[
                    { date: '2026-09-30', sets: [], note: 'Mantieni il fermo al petto' },
                    { date: '2026-09-28', sets: [], note: 'Nota più vecchia' },
                ]}
            />,
        );

        expect(screen.getByText(/Nota dall’ultima sessione:/i)).toBeDefined();
        expect(screen.getByText(/Mantieni il fermo al petto/i)).toBeDefined();
    });

    it('renders cardio history with cardio metrics instead of weight and reps', () => {
        render(
            <SessionExerciseCard
                {...baseExerciseProps}
                libDef={{ ...baseExerciseProps.libDef, trackingType: 'cardio' }}
                exItem={{ ...baseExerciseProps.exItem, sets: [{ id: 'cardio-set-1', kg: '', reps: '', time: '', distance: '' }] }}
                isHistoryOpen
                pastWorkouts={[
                    {
                        date: '2026-09-29',
                        note: '',
                        sets: [{ id: 'past-cardio', time: '30', distance: '5', speed: '10', incline: '2', kcal: '320' }],
                    },
                ]}
            />,
        );

        expect(screen.getByText(/30 min · 5 km · 10 km\/h · 2% incl\. · 320 kcal/i)).toBeDefined();
        expect(screen.queryByText(/\? kg × \?/i)).toBeNull();
    });

    it('disables impossible exercise position controls', () => {
        const { rerender } = render(
            <SessionExerciseCard
                {...baseExerciseProps}
                totalExercises={1}
            />,
        );

        expect((screen.getByRole('button', { name: 'Cambia posizione esercizio' }) as HTMLButtonElement).disabled).toBe(true);

        rerender(
            <SessionExerciseCard
                {...baseExerciseProps}
                totalExercises={2}
            />,
        );
        fireEvent.click(screen.getByRole('button', { name: 'Cambia posizione esercizio' }));

        expect((screen.getByRole('button', { name: /✓ 1ª posizione/i }) as HTMLButtonElement).disabled).toBe(true);
    });

    it('uses one consistent definition for empty and meaningful set data', () => {
        expect(sessionSetHasMeaningfulData({ id: 'blank', kg: '', reps: '' })).toBe(false);
        expect(sessionSetHasMeaningfulData({ id: 'zero', kg: '0,0', reps: '0.00' })).toBe(false);
        expect(sessionSetHasMeaningfulData({ id: 'rir-zero', kg: '', reps: '', rir: 0 })).toBe(true);
        expect(sessionSetHasMeaningfulData({ id: 'advanced', kg: '', reps: '', technique: 'dropset' })).toBe(true);
    });

    it('keeps the note for the next session compact until requested', () => {
        render(<SessionExerciseCard {...baseExerciseProps} />);

        const editor = screen.getByPlaceholderText('Note per la prossima volta (dolori, feedback)...');
        expect((editor as HTMLTextAreaElement).style.display).toBe('none');

        fireEvent.click(screen.getByRole('button', { name: /Aggiungi nota per la prossima volta/i }));

        expect((editor as HTMLTextAreaElement).style.display).toBe('block');
    });

    it('confirms removal of a filled set from the three-dot menu', async () => {
        const onRemoveSet = vi.fn();
        const confirm = vi.spyOn(useDialogStore.getState(), 'showConfirm').mockResolvedValue(false);

        render(
            <SessionSetRow
                set={{ id: 'set-filled', kg: '80', reps: '8' }}
                sIndex={0}
                exIndex={0}
                trackingType="weight_reps"
                isOpenMenu
                onToggleMenu={vi.fn()}
                onRemoveSet={onRemoveSet}
                onUpdateSet={vi.fn()}
                onAddSpecialSet={vi.fn()}
                onUpdateSpecialSet={vi.fn()}
                onRemoveSpecialSet={vi.fn()}
                onUpdateSetTarget={vi.fn()}
            />,
        );

        await act(async () => {
            fireEvent.click(screen.getByRole('button', { name: /Rimuovi questa serie/i }));
        });

        expect(confirm).toHaveBeenCalledTimes(1);
        expect(onRemoveSet).not.toHaveBeenCalled();
        confirm.mockRestore();
    });

    it('uses the median of the latest five matching completed sessions', () => {
        const history = [
            completedWorkout('routine-a', 10, 1),
            completedWorkout('routine-a', 20, 2),
            completedWorkout('routine-a', 30, 3),
            completedWorkout('routine-a', 40, 4),
            completedWorkout('routine-a', 50, 5),
            completedWorkout('routine-a', 55, 6),
            completedWorkout('routine-b', 300, 7),
        ];

        expect(getRoutineDurationEstimate('routine-a', history)).toEqual({
            minutes: 40,
            sampleSize: 5,
        });
    });

    it('does not invent a duration estimate with fewer than three usable sessions', () => {
        const history = [
            completedWorkout('routine-a', 45, 1),
            completedWorkout('routine-a', 50, 2),
            {
                id: 'invalid-duration',
                routineId: 'routine-a',
                globalDurationStr: 'invalid',
                exercises: [],
            } satisfies WorkoutSession,
        ];

        expect(getRoutineDurationEstimate('routine-a', history)).toBeNull();
    });
});
