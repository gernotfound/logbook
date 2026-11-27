import { act, renderHook } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../src/lib/firebase', () => {
    throw new Error('Il percorso allenamento guest ha caricato Firebase');
});

import { useWorkoutSession } from '../../src/hooks/useWorkoutSession';
import TrainingView from '../../src/components/Training/TrainingView';
import { authenticatedIdentitySource } from '../../src/lib/sync/authenticatedIdentitySource';
import { activateGuestSession, GUEST_SESSION_KEY, invalidateSession } from '../../src/lib/sync/session';
import { useAppStore } from '../../src/store/useAppStore';
import { useDialogStore } from '../../src/store/useDialogStore';
import { releaseLegacyTestIdentityReader } from '../setup';

beforeEach(() => {
    releaseLegacyTestIdentityReader();
    localStorage.clear();
    localStorage.setItem('logbook_is_guest', 'true');
    localStorage.setItem(GUEST_SESSION_KEY, 'guest-workout-current-generation');
    activateGuestSession('guest-workout-current-generation');
    useAppStore.getState().resetStore({ force: true });
});

describe('Allenamento guest indipendente da Firebase', () => {
    it('importa la vista e gli hook senza inizializzare l’SDK di identità legacy', () => {
        expect(typeof TrainingView).toBe('function');
        expect(authenticatedIdentitySource.hasReader()).toBe(false);
        const { result } = renderHook(() => useWorkoutSession());
        expect(typeof result.current.endWorkout).toBe('function');
        expect(typeof result.current.deleteWorkout).toBe('function');
    });

    it('non committa la chiusura del workout se la generazione guest cambia durante la conferma', async () => {
        let confirm!: (accepted: boolean) => void;
        const showConfirm = vi.mocked(useDialogStore.getState().showConfirm);
        showConfirm.mockImplementationOnce(() => new Promise(resolve => { confirm = resolve; }));
        const dispatch = vi.fn();
        const originalDispatch = useAppStore.getState().dispatchDomainOperation;
        useAppStore.setState({
            localWorkout: { id: 'guest-workout-obsoleto', routineName: 'Seduta', exercises: [] },
            dataOwner: 'guest',
            dispatchDomainOperation: dispatch,
        });
        try {
            const { result } = renderHook(() => useWorkoutSession());
            let pending!: ReturnType<typeof result.current.endWorkout>;
            act(() => { pending = result.current.endWorkout(); });
            invalidateSession();
            await act(async () => { confirm(true); expect(await pending).toBeNull(); });
            expect(dispatch).not.toHaveBeenCalled();
            expect(useAppStore.getState().localWorkout?.id).toBe('guest-workout-obsoleto');
        } finally {
            useAppStore.setState({ dispatchDomainOperation: originalDispatch });
        }
    });
});
