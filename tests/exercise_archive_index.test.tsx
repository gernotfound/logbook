import React from 'react';
import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { ExerciseArchive } from '../src/components/Training/exercises/ExerciseArchive';

describe('exercise archive normalization', () => {
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
