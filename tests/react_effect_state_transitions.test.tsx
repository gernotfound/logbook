import React from 'react';
import { act, fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import RecoveryBentoCard from '../src/components/Home/widgets/RecoveryBentoCard';
import TrainingPlanning from '../src/components/Training/planning/TrainingPlanning';
import { UserDataSchema } from '../src/lib/schema';
import { storageOwner } from '../src/lib/sync/session';
import { useAppStore } from '../src/store/useAppStore';

describe('React effect replacement with derived state', () => {
    it('collapses recovery disclosure after all pains disappear and does not reopen automatically', () => {
        const props = {
            activePains: ['chest_upper'],
            painColors: {},
            muscleColors: {},
            onTogglePain: vi.fn(),
        };
        const view = render(<RecoveryBentoCard {...props} />);
        fireEvent.click(screen.getByRole('button', { name: '1 dolori attivi' }));
        expect(screen.getByRole('button', { name: '1 dolori attivi' }).getAttribute('aria-expanded')).toBe('true');

        view.rerender(<RecoveryBentoCard {...props} activePains={[]} />);
        expect(screen.getByRole('button', { name: '0 dolori attivi' }).getAttribute('aria-expanded')).toBe('false');

        view.rerender(<RecoveryBentoCard {...props} />);
        expect(screen.getByRole('button', { name: '1 dolori attivi' }).getAttribute('aria-expanded')).toBe('false');
    });

    it('never carries the expanded details of an active cycle to a different cycle or back', () => {
        const data = UserDataSchema.parse({
            profile: {},
            routines: [{ id: 'routine-a', name: 'Scheda A', exercises: [] }],
            trainingCycles: [
                { id: 'cycle-a', name: 'Ciclo A', durationWeeks: 4, routines: [{ routineId: 'routine-a', frequencyPerWeek: 1 }] },
                { id: 'cycle-b', name: 'Ciclo B', durationWeeks: 4, routines: [{ routineId: 'routine-a', frequencyPerWeek: 1 }] },
            ],
            activeCycleId: 'cycle-a',
        });
        useAppStore.setState({ userData: data as any, dataOwner: storageOwner() });
        const view = render(<TrainingPlanning />);

        const details = screen.getByRole('button', { name: 'Dettagli ciclo' });
        fireEvent.click(details);
        expect(details.getAttribute('aria-expanded')).toBe('true');

        act(() => useAppStore.setState({ userData: { ...data, activeCycleId: 'cycle-b' } as any }));
        expect(screen.getByRole('button', { name: 'Dettagli ciclo' }).getAttribute('aria-expanded')).toBe('false');
        act(() => useAppStore.setState({ userData: { ...data, activeCycleId: 'cycle-a' } as any }));
        expect(screen.getByRole('button', { name: 'Dettagli ciclo' }).getAttribute('aria-expanded')).toBe('false');
        view.unmount();
    });
});
