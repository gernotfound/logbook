import React, { useState } from 'react';
import { act, fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { ExerciseArchive } from '../../../src/components/Training/exercises/ExerciseArchive';

const firstExercise = {
    id: 'a', name: 'Panca inclinata', setsCount: 4, sets: [], muscles: [],
    notes: 'Bilanciere', isDefault: false,
};
const secondExercise = {
    id: 'b', name: 'Rematore', setsCount: 3, sets: [], muscles: [],
    notes: '', isDefault: false,
};

function ArchiveWithSelection({ library, onDuplicate = vi.fn(), onDelete = vi.fn() }: {
    library: Array<typeof firstExercise>;
    onDuplicate?: React.ComponentProps<typeof ExerciseArchive>['onDuplicate'];
    onDelete?: React.ComponentProps<typeof ExerciseArchive>['onDelete'];
}) {
    const [selectedExId, setSelectedExId] = useState<string | null>(null);
    return <ExerciseArchive
        library={library}
        routines={[]}
        selectedExId={selectedExId}
        onSelectedExIdChange={setSelectedExId}
        onEditItem={vi.fn()}
        onDuplicate={onDuplicate}
        onDelete={onDelete}
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

    it('serializes duplicate and delete actions while the selected detail is busy', async () => {
        let finishDuplicate!: () => void;
        let finishDelete!: () => void;
        const onDuplicate = vi.fn(() => new Promise<void>(resolve => { finishDuplicate = resolve; }));
        const onDelete = vi.fn(() => new Promise<void>(resolve => { finishDelete = resolve; }));
        render(<ArchiveWithSelection library={[firstExercise]} onDuplicate={onDuplicate} onDelete={onDelete} />);
        fireEvent.click(screen.getByRole('button', { name: 'Apri dettaglio di Panca inclinata' }));

        const duplicate = screen.getByRole('button', { name: 'Duplica' }) as HTMLButtonElement;
        const deleteButton = screen.getByRole('button', { name: 'Elimina' }) as HTMLButtonElement;
        const editButton = screen.getByRole('button', { name: 'Modifica' }) as HTMLButtonElement;
        const backButton = screen.getByRole('button', { name: 'Torna all’elenco' }) as HTMLButtonElement;

        fireEvent.click(duplicate);
        fireEvent.click(duplicate);
        fireEvent.click(deleteButton);
        expect(onDuplicate).toHaveBeenCalledOnce();
        expect(onDelete).not.toHaveBeenCalled();
        expect(duplicate.disabled).toBe(true);
        expect(deleteButton.disabled).toBe(true);
        expect(editButton.disabled).toBe(true);
        expect(backButton.disabled).toBe(true);

        await act(async () => { finishDuplicate(); });
        expect(duplicate.disabled).toBe(false);
        fireEvent.click(deleteButton);
        fireEvent.click(deleteButton);
        fireEvent.click(duplicate);
        expect(onDelete).toHaveBeenCalledOnce();
        expect(onDuplicate).toHaveBeenCalledOnce();

        await act(async () => { finishDelete(); });
        expect(deleteButton.disabled).toBe(false);
        expect(backButton.disabled).toBe(false);
    });

    it('re-enables detail actions after an unexpected duplicate rejection', async () => {
        const onDuplicate = vi.fn()
            .mockRejectedValueOnce(new Error('Disk unavailable'))
            .mockResolvedValue(undefined);
        const log = vi.spyOn(console, 'error').mockImplementation(() => {});
        try {
            render(<ArchiveWithSelection library={[firstExercise]} onDuplicate={onDuplicate} />);
            fireEvent.click(screen.getByRole('button', { name: 'Apri dettaglio di Panca inclinata' }));
            const duplicate = screen.getByRole('button', { name: 'Duplica' }) as HTMLButtonElement;
            await act(async () => { fireEvent.click(duplicate); });
            expect(duplicate.disabled).toBe(false);
            expect(log).toHaveBeenCalledOnce();
            await act(async () => { fireEvent.click(duplicate); });
            expect(onDuplicate).toHaveBeenCalledTimes(2);
        } finally {
            log.mockRestore();
        }
    });
});
