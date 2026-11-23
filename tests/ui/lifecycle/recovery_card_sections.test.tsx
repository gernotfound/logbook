import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import RecoveryBentoCard from '../../../src/components/Home/widgets/RecoveryBentoCard';
import { Logic } from '../../../src/lib/logic';

afterEach(cleanup);

describe('recovery card extracted controls', () => {
    it('connects disclosure to its pain list and keeps the selected muscle action', () => {
        const muscle = Logic.searchMuscles('pettorali', 8)[0];
        expect(muscle).toBeDefined();
        const onTogglePain = vi.fn();
        render(<RecoveryBentoCard
            activePains={[muscle.id]} painColors={{}} onTogglePain={onTogglePain}
        />);

        const toggle = screen.getByRole('button', { name: '1 dolori attivi' });
        const panelId = toggle.getAttribute('aria-controls');
        expect(panelId).toBeTruthy();
        const panel = document.getElementById(panelId!);
        expect(panel).not.toBeNull();
        expect(panel?.getAttribute('aria-hidden')).toBe('true');

        fireEvent.click(toggle);
        expect(toggle.getAttribute('aria-expanded')).toBe('true');
        expect(panel?.getAttribute('aria-hidden')).toBe('false');

        const remove = screen.getByRole('button', { name: `Rimuovi dolore ${Logic.getMuscleName(muscle.id)}` });
        fireEvent.click(remove);
        expect(onTogglePain).toHaveBeenCalledExactlyOnceWith(muscle.id);
    });

    it('preserves search during same-state rerenders but clears it when all pains disappear', () => {
        const muscle = Logic.searchMuscles('pettorali', 8)[0];
        expect(muscle).toBeDefined();
        const props = { activePains: [muscle.id], painColors: {}, onTogglePain: vi.fn() };
        const view = render(<RecoveryBentoCard {...props} />);
        const search = screen.getByRole('textbox', { name: 'Cerca muscolo dolorante' });
        fireEvent.change(search, { target: { value: 'pettorali' } });
        expect(screen.getAllByRole('button', { pressed: true }).length).toBeGreaterThan(0);

        view.rerender(<RecoveryBentoCard {...props} activePains={[muscle.id]} />);
        expect(search).toHaveProperty('value', 'pettorali');
        fireEvent.click(screen.getAllByRole('button', { pressed: true })[0]);
        expect(props.onTogglePain).toHaveBeenCalledExactlyOnceWith(muscle.id);

        view.rerender(<RecoveryBentoCard {...props} activePains={[]} />);
        expect(screen.getByRole('textbox', { name: 'Cerca muscolo dolorante' })).toHaveProperty('value', '');
        expect(screen.queryByRole('button', { pressed: true })).toBeNull();
        expect(screen.getByRole('button', { name: '0 dolori attivi' })).toHaveProperty('disabled', true);
    });

    it('retains an explicit clear action in the search while pains are selected', () => {
        const muscle = Logic.searchMuscles('pettorali', 8)[0];
        const onTogglePain = vi.fn();
        render(<RecoveryBentoCard activePains={[muscle.id]} painColors={{}} onTogglePain={onTogglePain} />);
        const search = screen.getByRole('textbox', { name: 'Cerca muscolo dolorante' });
        fireEvent.change(search, { target: { value: 'pettorali' } });
        fireEvent.click(screen.getByRole('button', { name: 'Cancella ricerca' }));
        expect(search).toHaveProperty('value', '');
        expect(screen.queryByRole('button', { pressed: true })).toBeNull();
        expect(onTogglePain).not.toHaveBeenCalled();
    });
});
