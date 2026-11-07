import { act, cleanup, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
    dispatch: vi.fn(),
    showAlert: vi.fn(async (_message: string) => {}),
    blockStore: vi.fn(),
    readDraft: vi.fn(() => null),
    writeDraft: vi.fn(),
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
    isCurrentSession: () => true,
}));
vi.mock('../src/lib/sync/workoutRecoveryDraft', () => ({
    readWorkoutRecoveryDraft: mocks.readDraft,
    writeWorkoutRecoveryDraft: mocks.writeDraft,
}));

import { useTrainingRoutines } from '../src/hooks/useTrainingRoutines';

beforeEach(() => {
    mocks.dispatch.mockReset();
    mocks.blockStore.mockClear();
    mocks.showAlert.mockClear();
    mocks.readDraft.mockClear();
    mocks.writeDraft.mockClear();
});
afterEach(cleanup);

describe('routine editor durable failures', () => {
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
