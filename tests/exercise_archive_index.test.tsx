import React, { useState } from 'react';
import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { ExerciseArchive } from '../src/components/Training/exercises/ExerciseArchive';

const firstExercise = {
    id: 'a', name: 'Panca inclinata', setsCount: 4, sets: [], muscles: [],
    notes: 'Bilanciere', isDefault: false,
};
const secondExercise = {
    id: 'b', name: 'Rematore', setsCount: 3, sets: [], muscles: [],
    notes: '', isDefault: false,
};

function ArchiveWithSelection({ library }: { library: Array<typeof firstExercise> }) {
    const [selectedExId, setSelectedExId] = useState<string | null>(null);
    return <ExerciseArchive
        library={library}
        routines={[]}
        selectedExId={selectedExId}
        onSelectedExIdChange={setSelectedExId}
        onEditItem={vi.fn()}
        onDuplicate={vi.fn()}
        onDelete={vi.fn()}
    />;
}

describe('exercise archive normalization', () => {
    it('does not reopen a stale exercise detail when its ID returns after being removed', () => {
        const view = render(<ArchiveWithSelection library={[firstExercise, secondExercise]} />);
        fireEvent.click(screen.getByRole('button', { name: 'Apri dettaglio di Panca inclinata' }));
        expect(screen.getByRole('button', { name: 'Torna all’elenco' })).toBeDefined();

        view.rerender(<ArchiveWithSelection library={[secondExercise]} />);
        expect(screen.queryByRole('button', { name: 'Torna all’elenco' })).toBeNull();
        expect(screen.getByRole('button', { name: 'Apri dettaglio di Rematore' })).toBeDefined();

        view.rerender(<ArchiveWithSelection library={[firstExercise, secondExercise]} />);
        expect(screen.queryByRole('button', { name: 'Torna all’elenco' })).toBeNull();
        expect(screen.getByRole('button', { name: 'Apri dettaglio di Panca inclinata' })).toBeDefined();

        // A fresh selection still opens the detail normally.
        fireEvent.click(screen.getByRole('button', { name: 'Apri dettaglio di Panca inclinata' }));
        expect(screen.getByRole('button', { name: 'Torna all’elenco' })).toBeDefined();
    });

    it('preserves token search when a replacement library prop removes previous entries', () => {
        const callbacks = {
            routines: [],
            selectedExId: null,
            onSelectedExIdChange: vi.fn(),
            onEditItem: vi.fn(),
            onDuplicate: vi.fn(),
            onDelete: vi.fn(),
        };
        const view = render(<ExerciseArchive
            {...callbacks}
            library={[{ id: 'a', name: 'Panca inclinata', setsCount: 4, sets: [], muscles: [], notes: 'Bilanciere', isDefault: false }]}
        />);
        fireEvent.change(screen.getByRole('searchbox'), { target: { value: 'panca bilanciere' } });
        expect(screen.getByRole('button', { name: 'Apri dettaglio di Panca inclinata' })).toBeDefined();

        view.rerender(<ExerciseArchive
            {...callbacks}
            library={[{ id: 'b', name: 'Rematore', setsCount: 3, sets: [], muscles: [], notes: '', isDefault: false }]}
        />);
        expect(screen.queryByRole('button', { name: 'Apri dettaglio di Panca inclinata' })).toBeNull();
        expect(screen.getByText('Nessun esercizio trovato.')).toBeDefined();
    });
});
