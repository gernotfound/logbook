import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { SessionRoutineArchive } from '../../../src/components/Training/session/SessionRoutineArchive';
import type { WorkoutRoutine } from '../../../src/types';

const routines: WorkoutRoutine[] = [
    { id: 'r-spinta', name: 'Scheda spinta', exercises: [{ exId: 'bench', setsCount: 3 }] },
    { id: 'r-tirata', name: 'Scheda tirata', exercises: [] },
];
const estimates = new Map([['r-spinta', { minutes: 45, sampleSize: 5 }]]);

afterEach(cleanup);

describe('session routine archive', () => {
    it('filters by trimmed, case-insensitive name while preserving the selected routine ID', () => {
        const onStart = vi.fn();
        render(<SessionRoutineArchive routines={routines} durationEstimates={estimates} onStartRoutine={onStart} />);

        const section = screen.getByRole('region', { name: 'Scegli dall’archivio' });
        expect(within(section).getByText('2 schede')).toBeDefined();
        expect(within(section).getByText('Stima: mediana ultime 5 sessioni')).toBeDefined();

        const search = within(section).getByRole('searchbox', { name: 'Cerca scheda per nome' });
        fireEvent.change(search, { target: { value: ' SPINTA ' } });
        expect(within(section).getByRole('button', { name: /Scheda spinta/ })).toBeDefined();
        expect(within(section).queryByRole('button', { name: /Scheda tirata/ })).toBeNull();

        fireEvent.click(within(section).getByRole('button', { name: /Scheda spinta/ }));
        expect(onStart).toHaveBeenCalledExactlyOnceWith('r-spinta');

        fireEvent.change(search, { target: { value: 'non presente' } });
        expect(within(section).getByText('Nessuna scheda trovata.')).toBeDefined();
        expect(onStart).toHaveBeenCalledOnce();
    });

    it('refreshes visible options when routines change, without discarding the current search', () => {
        const onStart = vi.fn();
        const { rerender } = render(<SessionRoutineArchive routines={routines}
            durationEstimates={estimates} onStartRoutine={onStart} />);

        fireEvent.change(screen.getByRole('searchbox', { name: 'Cerca scheda per nome' }), {
            target: { value: 'tirata' },
        });
        rerender(<SessionRoutineArchive routines={[routines[0]]}
            durationEstimates={estimates} onStartRoutine={onStart} />);
        expect(screen.getByText('Nessuna scheda trovata.')).toBeDefined();
        expect(screen.getByRole('searchbox', { name: 'Cerca scheda per nome' })).toHaveProperty('value', 'tirata');
        expect(onStart).not.toHaveBeenCalled();
    });
});
