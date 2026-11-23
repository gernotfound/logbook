import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { KindeCandidateSleep } from '../../../src/components/Data/KindeCandidateSleep';
import type { useKindeCandidateFitnessLifecycle } from '../../../src/contexts/auth/useKindeCandidateFitnessLifecycle';
import type { KindeSleepDraft } from '../../../src/lib/auth/kindeCandidateSleepDraft';
import { useAppStore } from '../../../src/store/useAppStore';

const original = () => useAppStore.getState();
afterEach(() => { cleanup(); });

function fixture() {
    let current = true;
    const draft: KindeSleepDraft = {
        initial: {
            date: '2026-11-20', hasExisting: false, submitted: false,
            values: { sleepHours: '', sleepDeep: '', sleepLight: '',
                sleepRem: '', sleepAwake: '' },
        },
        write: vi.fn(),
        discard: vi.fn(),
        close: vi.fn(),
    };
    const realm = {
        state: {
            phase: 'ready',
            snapshot: { owner: 'user:k_' + 'X'.repeat(43),
                principal: { uid: 'k_' + 'X'.repeat(43), fenceEpoch: 1, healthConsentRevision: 1 },
                data: { nutrition: {} },
            },
        },
        captureEditWitness: () => ({ isCurrent: () => current }),
        openSleepDraft: vi.fn(async () => draft),
        saveSleepDraft: vi.fn(async () => ({
            outcome: { kind: 'cloud-acknowledged' as const }, draftCleared: true,
        })),
    } as unknown as ReturnType<typeof useKindeCandidateFitnessLifecycle>;
    return { draft, realm, invalidate: () => { current = false; } };
}

describe('Kinde candidate sleep UI', () => {
    it('writes each input through the Kinde draft and sends exactly one realm save, not the guest writer', async () => {
        const { draft, realm } = fixture();
        const state = original();
        const guestWrite = vi.fn();
        useAppStore.setState({ dispatchDomainOperation: guestWrite as typeof state.dispatchDomainOperation });
        try {
            render(<KindeCandidateSleep realm={realm} />);
            fireEvent.change(screen.getByLabelText('Data della notte'), { target: { value: '2026-11-20' } });
            fireEvent.click(screen.getByRole('button', { name: 'Inserisci o riprendi sonno' }));
            await waitFor(() => expect(realm.openSleepDraft).toHaveBeenCalledWith('2026-11-20'));
            fireEvent.change(screen.getByLabelText('Ore di sonno totali'), { target: { value: '07:30' } });
            expect(draft.write).toHaveBeenCalledWith(expect.objectContaining({ sleepHours: '07:30' }));
            fireEvent.click(screen.getByRole('button', { name: 'Salva sonno' }));
            await waitFor(() => expect(realm.saveSleepDraft).toHaveBeenCalledTimes(1));
            expect(realm.saveSleepDraft).toHaveBeenCalledWith(draft);
            expect(guestWrite).not.toHaveBeenCalled();
        } finally {
            useAppStore.setState({ dispatchDomainOperation: state.dispatchDomainOperation });
        }
    });

    it('hides all account sleep controls without ready consent and does not adopt guest data', () => {
        const { realm } = fixture();
        const closed = { ...realm, state: { phase: 'closed' } } as ReturnType<typeof useKindeCandidateFitnessLifecycle>;
        const { rerender } = render(<KindeCandidateSleep realm={closed} />);
        expect(screen.queryByRole('region', { name: 'Sonno account' })).toBeNull();
        rerender(<KindeCandidateSleep realm={realm} />);
        expect(screen.getByRole('region', { name: 'Sonno account' })).toBeDefined();
        expect(screen.queryByText('Sonno inserito da ospite')).toBeNull();
    });

    it('does not allow input writes after an owner/session witness becomes invalid', async () => {
        const { draft, realm, invalidate } = fixture();
        render(<KindeCandidateSleep realm={realm} />);
        fireEvent.click(screen.getByRole('button', { name: 'Inserisci o riprendi sonno' }));
        await waitFor(() => expect(screen.getByLabelText('Ore di sonno totali')).toBeDefined());
        invalidate();
        fireEvent.change(screen.getByLabelText('Ore di sonno totali'), { target: { value: '08:00' } });
        expect(draft.write).not.toHaveBeenCalled();
        fireEvent.click(screen.getByRole('button', { name: 'Salva sonno' }));
        expect(realm.saveSleepDraft).not.toHaveBeenCalled();
    });
});
