import { act, cleanup, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
    dispatch: vi.fn(),
    showAlert: vi.fn(async (_message: string) => {}),
    showConfirm: vi.fn(async (_message: string) => true),
    blockStore: vi.fn(),
    readDraft: vi.fn(() => ({ value: null, raw: null })),
    writeDraft: vi.fn(() => null),
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
        showConfirm: mocks.showConfirm,
    }),
}));
vi.mock('../src/lib/sync/session', () => ({
    captureSession: () => ({ owner: 'guest', epoch: 1 }),
    isCurrentSession: () => mocks.currentSession,
}));
vi.mock('../src/lib/sync/workoutRecoveryDraft', () => ({
    readWorkoutRecoveryDraftImage: mocks.readDraft,
    writeWorkoutRecoveryDraft: mocks.writeDraft,
}));

import { useTrainingRoutines } from '../src/hooks/useTrainingRoutines';

beforeEach(() => {
    mocks.currentSession = true;
    mocks.dispatch.mockReset();
    mocks.blockStore.mockClear();
    mocks.showAlert.mockClear();
    mocks.showConfirm.mockReset().mockResolvedValue(true);
    mocks.readDraft.mockClear();
    mocks.writeDraft.mockClear();
});
afterEach(cleanup);

describe('routine editor durable failures', () => {
    it('preserves invalid set counts for correction without changing plans or committing them', async () => {
        const { result } = renderHook(() => useTrainingRoutines());
        act(() => result.current.setRoutineName('Scheda'));
        act(() => result.current.handleAddExerciseToRoutine('bench'));
        act(() => result.current.handleUpdateSetsCount(0, '4'));
        expect(result.current.routineExercises[0].setPlans).toHaveLength(4);

        for (const rawCount of ['2.5', '1e2', '21', '0', '-1', 'invalid']) {
            act(() => result.current.handleUpdateSetsCount(0, rawCount));
            expect(result.current.routineExercises[0].setsCount).toBe(rawCount);
            expect(result.current.routineExercises[0].setPlans).toHaveLength(4);
            await act(async () => { expect(await result.current.handleSave()).toBe(false); });
            expect(mocks.dispatch).not.toHaveBeenCalled();
        }

        act(() => result.current.handleUpdateSetsCount(0, '2'));
        expect(result.current.routineExercises[0].setsCount).toBe(2);
        expect(result.current.routineExercises[0].setPlans).toHaveLength(2);

        mocks.dispatch.mockResolvedValue({ ok: true, status: 'synced' });
        await act(async () => { expect(await result.current.handleSave()).toBe(true); });
        expect(mocks.dispatch).toHaveBeenCalledWith(expect.arrayContaining([
            expect.objectContaining({
                type: 'routine.upsert',
                routine: expect.objectContaining({
                    exercises: [expect.objectContaining({ exId: 'bench', setsCount: 2 })],
                }),
            }),
        ]));
    });

    it('rejects an empty set count rather than saving an invented three-set routine', async () => {
        const { result } = renderHook(() => useTrainingRoutines());
        act(() => result.current.setRoutineName('Scheda'));
        act(() => result.current.handleAddExerciseToRoutine('bench'));
        act(() => result.current.handleUpdateSetsCount(0, ''));

        let saved!: boolean;
        await act(async () => { saved = await result.current.handleSave(); });

        expect(saved).toBe(false);
        expect(result.current.routineExercises[0].setsCount).toBe('');
        expect(mocks.showAlert).toHaveBeenCalledWith(
            'Ogni esercizio può contenere da 1 a 20 serie. Correggi il valore prima di salvare la scheda.',
        );
        expect(mocks.dispatch).not.toHaveBeenCalled();
    });

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

    it('refuses a confirmed routine deletion after an Auth A→B→A replacement', async () => {
        let complete!: (value: boolean) => void;
        mocks.showConfirm.mockImplementationOnce(() => new Promise<boolean>(resolve => { complete = resolve; }));
        const { result } = renderHook(() => useTrainingRoutines());
        let pending!: Promise<void>;
        const event = { stopPropagation: vi.fn() };
        act(() => { pending = result.current.handleDelete('routine-same-id', event); });
        expect(mocks.showConfirm).toHaveBeenCalledOnce();
        mocks.currentSession = false;
        await act(async () => { complete(true); await pending; });
        expect(mocks.dispatch).not.toHaveBeenCalled();
        expect(mocks.showAlert).not.toHaveBeenCalled();
        expect(event.stopPropagation).toHaveBeenCalledOnce();
    });

    it('does not duplicate a routine from an editor mounted in an obsolete Auth epoch', async () => {
        const { result } = renderHook(() => useTrainingRoutines());
        mocks.currentSession = false;
        await act(async () => {
            await result.current.handleDuplicate({ id: 'r-same', name: 'Old routine', exercises: [] });
        });
        expect(mocks.dispatch).not.toHaveBeenCalled();
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
        }, undefined, null);
    });
});
