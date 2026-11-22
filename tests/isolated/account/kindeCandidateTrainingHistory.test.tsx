import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { useKindeCandidateFitnessLifecycle } from '../../../src/contexts/auth/useKindeCandidateFitnessLifecycle';
import { KindeCandidateTrainingHistory } from '../../../src/components/Training/KindeCandidateTrainingHistory';
import { useAppStore } from '../../../src/store/useAppStore';
import type { KindeCandidateFitnessSnapshot } from '../../../src/lib/auth/kindeCandidateFitnessRealm';
import type { WorkoutSession } from '../../../src/types';

const accountWorkout: WorkoutSession = {
    id: 'account-workout', date: '2026-11-20', routineName: 'Sessione account',
    globalStartTime: Date.UTC(2026, 10, 20, 11), globalEndTime: Date.UTC(2026, 10, 20, 11, 45),
    exercises: [{ exId: 'account-ex', sessionNote: '', sets: [
        { id: 'account-set', kg: '40', reps: '10', done: true },
    ] }],
};
const otherWorkout: WorkoutSession = {
    id: 'other-owner', date: '2026-11-20', routineName: 'Sessione privata estranea', exercises: [],
};
const uid = 'k_' + 'U'.repeat(43);
const account: KindeCandidateFitnessSnapshot = {
    owner: 'user:' + uid,
    principal: { uid, fenceEpoch: 1, healthConsentRevision: 1 },
    data: {
        history: [accountWorkout],
        library: [{ id: 'account-ex', name: 'Squat autorizzato', setsCount: 1, sets: [] }],
    },
};

function candidate(phase: 'ready' | 'closed') {
    return {
        state: phase === 'ready'
            ? { phase, snapshot: account, view: {}, hasPendingJournal: false }
            : { phase },
        submit: vi.fn(),
    } as unknown as ReturnType<typeof useKindeCandidateFitnessLifecycle>;
}

afterEach(() => { cleanup(); });

describe('Kinde training history: owner-scoped read-only presentation', () => {
    it('does not adopt legacy owner data or expose legacy edit/delete actions', () => {
        const oldData = useAppStore.getState().userData;
        const oldOwner = useAppStore.getState().dataOwner;
        const oldDispatch = useAppStore.getState().dispatchDomainOperation;
        const oldWriter = vi.fn();
        useAppStore.setState({
            dataOwner: 'guest',
            userData: { history: [otherWorkout] },
            dispatchDomainOperation: oldWriter as typeof oldDispatch,
        });
        try {
            const { rerender } = render(<KindeCandidateTrainingHistory realm={candidate('ready')} />);
            expect(screen.getByRole('heading', { name: 'Storico allenamenti' })).toBeDefined();
            expect(screen.getByText('Sessione account')).toBeDefined();
            expect(screen.queryByText('Sessione privata estranea')).toBeNull();

            fireEvent.click(screen.getByRole('button', { name: 'Opzioni' }));
            expect(screen.getByRole('menuitem', { name: 'Vedi report' })).toBeDefined();
            expect(screen.queryByRole('menuitem', { name: 'Modifica allenamento' })).toBeNull();
            expect(screen.queryByRole('menuitem', { name: 'Elimina allenamento' })).toBeNull();
            fireEvent.click(screen.getByRole('menuitem', { name: 'Vedi report' }));
            expect(screen.getByRole('dialog', { name: 'Sessione account' })).toBeDefined();
            expect(screen.getByText('Squat autorizzato')).toBeDefined();
            expect(oldWriter).not.toHaveBeenCalled();

            rerender(<KindeCandidateTrainingHistory realm={candidate('closed')} />);
            expect(screen.queryByRole('dialog')).toBeNull();
            expect(screen.queryByRole('heading', { name: 'Storico allenamenti' })).toBeNull();
            expect(oldWriter).not.toHaveBeenCalled();
        } finally {
            useAppStore.setState({ dataOwner: oldOwner, userData: oldData, dispatchDomainOperation: oldDispatch });
        }
    });

    it('shows only an empty history for a newly consented account', () => {
        const realm = {
            state: { phase: 'ready', snapshot: { ...account, data: { history: [] } } },
        } as unknown as ReturnType<typeof useKindeCandidateFitnessLifecycle>;
        render(<KindeCandidateTrainingHistory realm={realm} />);
        expect(screen.getByText('Nessun allenamento in questo giorno.')).toBeDefined();
        expect(screen.queryByRole('button', { name: 'Opzioni' })).toBeNull();
    });
});
