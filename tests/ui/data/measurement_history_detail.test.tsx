import { fireEvent, render, screen, within } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import DataHistory from '../../../src/components/Data/DataHistory';

describe('measurement detail: validated sleep presentation', () => {
    it('keeps the detail accessible without fabricating a sleep value from invalid input', () => {
        render(
            <DataHistory
                measurementsHistory={[{ date: '2026-11-20', weight: 81, sleepHours: 'not-a-duration' }]}
                editingDate={null}
                onSelectEdit={vi.fn()}
            />,
        );
        fireEvent.click(screen.getByRole('button', { name: /Apri dettaglio/i }));
        const dialog = screen.getByRole('dialog');
        expect(within(dialog).getByText('81 kg')).toBeDefined();
        expect(within(dialog).queryByText('Sonno')).toBeNull();
        expect(within(dialog).queryByText('not-a-duration')).toBeNull();
    });

    it('continues showing valid sleep data in the same detail view', () => {
        render(
            <DataHistory
                measurementsHistory={[{ date: '2026-11-20', sleepHours: '07:30' }]}
                editingDate={null}
                onSelectEdit={vi.fn()}
            />,
        );
        fireEvent.click(screen.getByRole('button', { name: /Apri dettaglio/i }));
        const dialog = screen.getByRole('dialog');
        expect(within(dialog).getByText('07:30')).toBeDefined();
        expect(within(dialog).getByText('Sonno')).toBeDefined();
    });
});
