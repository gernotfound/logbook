import { fireEvent, render, screen, within } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import DataHistory from '../../../src/components/Data/DataHistory';

const date = '2026-10-05';

describe('DataHistory detail follows current source records', () => {
    it('refreshes an open detail and sends the latest record to the editor', () => {
        const onSelectEdit = vi.fn();
        const original = { date, weight: 81.4 };
        const updated = { date, weight: 79.2 };
        const { rerender } = render(
            <DataHistory measurementsHistory={[original]} editingDate={null} onSelectEdit={onSelectEdit} />,
        );

        fireEvent.click(screen.getByRole('button', { name: /Apri dettaglio/i }));
        expect(within(screen.getByRole('dialog')).getByText('81,4 kg')).toBeDefined();

        rerender(<DataHistory measurementsHistory={[updated]} editingDate={null} onSelectEdit={onSelectEdit} />);
        const dialog = screen.getByRole('dialog');
        expect(within(dialog).getByText('79,2 kg')).toBeDefined();
        expect(within(dialog).queryByText('81,4 kg')).toBeNull();

        fireEvent.click(within(dialog).getByRole('button', { name: 'Modifica' }));
        expect(onSelectEdit).toHaveBeenCalledTimes(1);
        expect(onSelectEdit).toHaveBeenCalledWith(updated);
    });

    it('keeps a single day open when its measurement time changes', () => {
        const original = { date, measurementTime: '07:30', weight: 81 };
        const updated = { date, measurementTime: '08:00', weight: 80 };
        const { rerender } = render(
            <DataHistory measurementsHistory={[original]} editingDate={null} onSelectEdit={vi.fn()} />,
        );
        fireEvent.click(screen.getByRole('button', { name: /Apri dettaglio/i }));

        rerender(<DataHistory measurementsHistory={[updated]} editingDate={null} onSelectEdit={vi.fn()} />);
        const dialog = screen.getByRole('dialog');
        expect(within(dialog).getByText('80 kg')).toBeDefined();
        expect(within(dialog).getByText(/08:00/)).toBeDefined();
        expect(within(dialog).queryByText('81 kg')).toBeNull();
    });

    it('closes an open detail when the recorded day disappears', () => {
        const { rerender } = render(
            <DataHistory measurementsHistory={[{ date, weight: 81.4 }]}
                editingDate={null} onSelectEdit={vi.fn()} />,
        );
        fireEvent.click(screen.getByRole('button', { name: /Apri dettaglio/i }));
        expect(screen.getByRole('dialog')).toBeDefined();
        expect(document.body.style.overflow).toBe('hidden');

        rerender(<DataHistory measurementsHistory={[]} editingDate={null} onSelectEdit={vi.fn()} />);
        expect(screen.queryByRole('dialog')).toBeNull();
        expect(document.body.style.overflow).toBe('');

        // A new sync result for the same calendar day is not a new user intent.
        rerender(<DataHistory measurementsHistory={[{ date, weight: 79.2 }]}
            editingDate={null} onSelectEdit={vi.fn()} />);
        expect(screen.queryByRole('dialog')).toBeNull();
    });

    it('keeps the correct same-day record when multiple distinct times are reordered', () => {
        const earlier = { date, measurementTime: '07:30', weight: 80 };
        const later = { date, measurementTime: '09:00', weight: 82 };
        const updatedLater = { date, measurementTime: '09:00', weight: 83 };
        const { rerender } = render(
            <DataHistory measurementsHistory={[earlier, later]} editingDate={null} onSelectEdit={vi.fn()} />,
        );
        fireEvent.click(screen.getAllByRole('button', { name: /Apri dettaglio/i })[1]);
        expect(within(screen.getByRole('dialog')).getByText('82 kg')).toBeDefined();

        rerender(<DataHistory measurementsHistory={[updatedLater, earlier]}
            editingDate={null} onSelectEdit={vi.fn()} />);
        const dialog = screen.getByRole('dialog');
        expect(within(dialog).getByText('83 kg')).toBeDefined();
        expect(within(dialog).queryByText('80 kg')).toBeNull();
    });

    it('fails closed for an ambiguous same-day replacement without unique identity', () => {
        const selected = { date, measurementTime: '09:00', weight: 82 };
        const { rerender } = render(
            <DataHistory measurementsHistory={[selected]} editingDate={null} onSelectEdit={vi.fn()} />,
        );
        fireEvent.click(screen.getByRole('button', { name: /Apri dettaglio/i }));

        rerender(<DataHistory
            measurementsHistory={[
                { date, measurementTime: '09:00', weight: 83 },
                { date, measurementTime: '09:00', weight: 84 },
            ]}
            editingDate={null} onSelectEdit={vi.fn()}
        />);
        expect(screen.queryByRole('dialog')).toBeNull();
    });
});
