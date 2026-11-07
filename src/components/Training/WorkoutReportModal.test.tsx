import React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import type { WorkoutSession } from '../../types';
import WorkoutReportModal from './WorkoutReportModal';

const { dispatch, showAlert } = vi.hoisted(() => ({
    dispatch: vi.fn(),
    showAlert: vi.fn(async () => undefined),
}));

vi.mock('../../store/useAppStore', () => ({
    useAppStore: (selector: (state: unknown) => unknown) => selector({
        dispatchDomainOperation: dispatch,
        userData: { nutrition: {} },
    }),
}));

vi.mock('../../store/useDialogStore', () => ({
    useDialogStore: (selector: (state: unknown) => unknown) => selector({ showAlert }),
}));

vi.mock('../../lib/calc/workoutReport', () => ({
    computeWorkoutReport: () => ({
        workoutName: 'Allenamento libero',
        date: '2026-11-07',
        durationSeconds: 60,
        totalVolume: 0,
        totalVolumeIsComplete: true,
        exerciseComparisons: [],
        newPRs: [],
        isFirstSession: false,
    }),
}));

const workout = {
    id: 'workout-1',
    date: '2026-11-07',
    routineName: 'Allenamento libero',
    exercises: [{ id: 'session-exercise-1', exId: 'exercise-1', sets: [
        { id: 'set-1', kg: '10', reps: '8' },
    ] }],
} as WorkoutSession;

function openSaveAsRoutine() {
    render(<WorkoutReportModal
        workout={workout}
        history={[]}
        library={[]}
        fromEndWorkout
        onClose={vi.fn()}
    />);
    fireEvent.click(screen.getByRole('button', { name: 'Salva come scheda' }));
    const name = screen.getByRole('textbox', { name: 'Nome nuova scheda' }) as HTMLInputElement;
    fireEvent.change(name, { target: { value: 'Scheda da salvare' } });
    fireEvent.click(screen.getByRole('button', { name: 'Salva' }));
}

describe('WorkoutReportModal - conferma del salvataggio scheda', () => {
    beforeEach(() => vi.clearAllMocks());
    afterEach(() => cleanup());

    it('non dichiara salvata una scheda se il commit locale fallisce con errore di rete', async () => {
        dispatch.mockResolvedValueOnce({
            ok: false, status: 'failed',
            error: Object.assign(new Error('unavailable'), { code: 'unavailable' }),
        });

        openSaveAsRoutine();

        await waitFor(() => expect(showAlert).toHaveBeenCalledWith('Errore durante il salvataggio della scheda.'));
        expect(screen.getByRole('textbox', { name: 'Nome nuova scheda' })).toHaveProperty('value', 'Scheda da salvare');
        expect(screen.getByRole('button', { name: 'Salva' })).not.toHaveProperty('disabled', true);
        expect(showAlert).not.toHaveBeenCalledWith('Scheda salvata in locale (offline).');
        expect(dispatch).toHaveBeenCalledWith(expect.objectContaining({
            type: 'routine.upsert',
            routine: expect.objectContaining({ name: 'Scheda da salvare' }),
        }));
    });

    it('accetta il salvataggio locale soltanto quando il boundary restituisce local-pending', async () => {
        dispatch.mockResolvedValueOnce({ ok: false, status: 'local-pending' });

        openSaveAsRoutine();

        await waitFor(() => expect(screen.queryByRole('textbox', { name: 'Nome nuova scheda' })).toBeNull());
        expect(showAlert).not.toHaveBeenCalled();
        expect(dispatch).toHaveBeenCalledTimes(1);
    });
});
