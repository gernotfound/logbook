import React from 'react';
import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import SessionSetRow from '../src/components/Training/session/SessionSetRow';
import SessionExerciseCard from '../src/components/Training/session/SessionExerciseCard';

describe('live workout callback freshness with memoized set rows', () => {
    it('routes an unchanged row to the latest callbacks after a parent update', () => {
        const set = { id: 'set-1', kg: '', reps: '' };
        const oldToggle = vi.fn();
        const currentToggle = vi.fn();
        const oldRemove = vi.fn();
        const currentRemove = vi.fn();
        const handlers = {
            onUpdateSet: vi.fn(),
            onAddSpecialSet: vi.fn(),
            onUpdateSpecialSet: vi.fn(),
            onRemoveSpecialSet: vi.fn(),
            onUpdateSetTarget: vi.fn(),
        };
        const props = { set, sIndex: 2, exIndex: 3, trackingType: 'weight_reps',
            isOpenMenu: false, onToggleMenu: oldToggle, onRemoveSet: oldRemove, ...handlers };
        const { rerender } = render(<SessionSetRow {...props} />);
        rerender(<SessionSetRow {...props} onToggleMenu={currentToggle} onRemoveSet={currentRemove} />);
        fireEvent.click(screen.getByRole('button', { name: 'Opzioni serie 3' }));
        fireEvent.click(screen.getByRole('button', { name: 'Rimuovi serie 3' }));
        expect(currentToggle).toHaveBeenCalledWith('set-1');
        expect(currentRemove).toHaveBeenCalledWith(3, 2);
        expect(oldToggle).not.toHaveBeenCalled();
        expect(oldRemove).not.toHaveBeenCalled();
    });

    it('keeps the exercise index when adding an advanced technique', () => {
        const addSpecial = vi.fn();
        render(<SessionSetRow
            set={{ id: 'set-2', kg: '30', reps: '10' }}
            exIndex={4} sIndex={0} isOpenMenu={true}
            onToggleMenu={vi.fn()} onRemoveSet={vi.fn()} onUpdateSet={vi.fn()}
            onAddSpecialSet={addSpecial} onUpdateSpecialSet={vi.fn()}
            onRemoveSpecialSet={vi.fn()} onUpdateSetTarget={vi.fn()}
        />);
        fireEvent.click(screen.getByRole('button', { name: '+ Dropset' }));
        expect(addSpecial).toHaveBeenCalledWith(4, 'dropset', 'set-2');
    });

    it('updates callbacks through the memoized exercise card without changing set identity', () => {
        const originalRemove = vi.fn();
        const nextRemove = vi.fn();
        const exItem = { exId: 'press', sessionNote: '', sets: [{ id: 'set-3', kg: '', reps: '' }] };
        const props = {
            exItem, exIndex: 5, totalExercises: 1,
            libDef: { name: 'Press', trackingType: 'weight_reps' },
            pastWorkouts: [], isHistoryOpen: false, isSetupOpen: false,
            openSpecialMenuId: null,
            onToggleHistory: vi.fn(), onToggleSetup: vi.fn(),
            onRemoveExercise: vi.fn(), onUpdateSetupNote: vi.fn(),
            onUpdateSessionNote: vi.fn(), onUpdateTechnicalStandard: vi.fn(),
            onAddSet: vi.fn(), onRemoveSet: originalRemove,
            onUpdateSet: vi.fn(), onAddSpecialSet: vi.fn(),
            onUpdateSpecialSet: vi.fn(), onRemoveSpecialSet: vi.fn(),
            onUpdateSetTarget: vi.fn(), onToggleSpecialMenu: vi.fn(),
        };
        const { rerender } = render(<SessionExerciseCard {...props} />);
        rerender(<SessionExerciseCard {...props} onRemoveSet={nextRemove} />);
        fireEvent.click(screen.getByRole('button', { name: 'Rimuovi serie 1' }));
        expect(nextRemove).toHaveBeenCalledWith(5, 0);
        expect(originalRemove).not.toHaveBeenCalled();
    });
});
