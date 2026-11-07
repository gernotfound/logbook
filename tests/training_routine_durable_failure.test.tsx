import { act, cleanup, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
    dispatch: vi.fn(),
    showAlert: vi.fn(async (_message: string) => {}),
    blockStore: vi.fn(),
    readDraft: vi.fn(() => null),
    writeDraft: vi.fn(),
    currentSession: true,
}));

vi.mock('../src/store/useAppStore', () => ({
    useAppStore: Object.assign(
        (select: (state: unknown) => unknown) => select({
            userData: { routines: [], library: [] },
            dispatchDomainOperation: mocks.dispatch,
            localPersistenceBlocked: false,
        }),
        { setState: mocks.blockStore },
    ),
}));
vi.mock('../src/store/useDialogStore', () => ({
    useDialogStore: (select: (state: unknown) => unknown) => select({
        showAlert: mocks.showAlert,
        showConfirm: vi.fn(),
    }),
}));
vi.mock('../src/lib/sync/session', () => ({
    captureSession: () => ({ owner: 'guest', epoch: 1 }),
    isCurrentSession: () => mocks.currentSession,
}));
vi.mock('../src/lib/sync/workoutRecoveryDraft', () => ({
    readWorkoutRecoveryDraft: mocks.readDraft,
    writeWorkoutRecoveryDraft: mocks.writeDraft,
}));

import { useTrainingRoutines } from '../src/hooks/useTrainingRoutines';

beforeEach(() => {
    mocks.currentSession = true;
    mocks.dispatch.mockReset();
    mocks.blockStore.mockClear();
    mocks.showAlert.mockClear();
    mocks.readDraft.mockClear();
    mocks.writeDraft.mockClear();
});
afterEach(cleanup);

describe('routine editor durable failures', () => {
    it('does not quarantine the next session when a previous editor fails its ownership check', () => {
        const { result } = renderHook(() => useTrainingRoutines());
        act(() => result.current.setRoutineName('Bozza precedente'));
        mocks.currentSession = false;
        let cancelled!: boolean;
        act(() => { cancelled = result.current.handleCancelEdit(); });
        expect(cancelled).toBe(false);
        expect(result.current.routineName).toBe('Bozza precedente');
        expect(mocks.blockStore).not.toHaveBeenCalled();
    });

    it('suppresses an obsolete failed-save alert after a session replacement', async () => {
        let reject!: (error: Error) => void;
        mocks.dispatch.mockImplementationOnce(() => new Promise((_resolve, fail) => { reject = fail; }));
        const { result } = renderHook(() => useTrainingRoutines());
        act(() => result.current.setRoutineName('Scheda prima del cambio sessione'));
        let pending!: Promise<boolean>;
        act(() => { pending = result.current.handleSave(); });
        mocks.currentSession = false;
        await act(async () => { reject(new Error('old request')); expect(await pending).toBe(false); });
        expect(mocks.showAlert).not.toHaveBeenCalled();
        expect(mocks.blockStore).not.toHaveBeenCalled();
    });

    it('reports post-commit cleanup failure without asking the user to resubmit a committed routine', async () => {
        mocks.dispatch.mockResolvedValue({ ok: true, status: 'synced' });
        const { result } = renderHook(() => useTrainingRoutines());
        act(() => result.current.setRoutineName('Scheda impegnata'));
        mocks.writeDraft.mockImplementationOnce(() => { throw new Error('quota'); });
        let saved!: boolean;
        await act(async () => { saved = await result.current.handleSave(); });
        expect(saved).toBe(true);
        expect(mocks.dispatch).toHaveBeenCalledOnce();
        expect(mocks.blockStore).toHaveBeenCalledWith(expect.objectContaining({ localPersistenceBlocked: true }));
        expect(mocks.showAlert).toHaveBeenCalledWith(expect.stringContaining('Scheda salvata, ma la bozza cifrata'));
    });

    it('keeps the form visible when deletion of its sealed draft is rejected', () => {
        const { result } = renderHook(() => useTrainingRoutines());
        act(() => result.current.setRoutineName('Scheda non cancellabile'));
        mocks.writeDraft.mockImplementationOnce(() => { throw new Error('quota'); });

        let cancelled!: boolean;
        act(() => { cancelled = result.current.handleCancelEdit(); });
        expect(cancelled).toBe(false);
        expect(result.current.routineName).toBe('Scheda non cancellabile');
        expect(mocks.blockStore).toHaveBeenCalledWith(expect.objectContaining({
            localPersistenceBlocked: true, syncHealth: 'failed',
        }));
    });

    it('retains a retryable routine draft without quarantining local storage when the domain commit fails', async () => {
        mocks.dispatch.mockResolvedValue({ ok: false, status: 'failed', error: new Error('commit rejected') });
        const { result } = renderHook(() => useTrainingRoutines());
        act(() => result.current.setRoutineName('Scheda da salvare'));

        let saved!: boolean;
        await act(async () => { saved = await result.current.handleSave(); });

        expect(saved).toBe(false);
        expect(result.current.routineName).toBe('Scheda da salvare');
        expect(mocks.dispatch).toHaveBeenCalledOnce();
        expect(mocks.showAlert).toHaveBeenCalledWith('Errore durante il salvataggio della scheda.');
        expect(mocks.blockStore).not.toHaveBeenCalled();
        expect(mocks.writeDraft).toHaveBeenCalledWith('draft_routine', 'guest', {
            name: 'Scheda da salvare',
            exercises: [],
        }, undefined);
    });
});
