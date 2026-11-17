import React from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { RoutineExerciseItem } from '../../../src/components/Training/routines/RoutineExerciseItem';

afterEach(cleanup);

describe('routine set count integer-only input', () => {
    it('offers a numeric mobile keyboard and ignores decimal, exponent and signed input', () => {
        const onUpdateSetsCount = vi.fn();
        render(
            <RoutineExerciseItem
                exercise={{ exId: 'bench', setsCount: 3 }}
                index={0}
                totalExercises={1}
                onMove={vi.fn()}
                onRemove={vi.fn()}
                onUpdateSetsCount={onUpdateSetsCount}
                onUpdateReps={vi.fn()}
                onUpdateSetPlan={vi.fn()}
                onUpdateSetPlanField={vi.fn()}
                onUpdateExerciseMetadata={vi.fn()}
            />,
        );
        const field = screen.getByLabelText('Serie:') as HTMLInputElement;
        expect(field.type).toBe('text');
        expect(field.inputMode).toBe('numeric');
        expect(field.pattern).toBe('[0-9]*');

        for (const value of ['2.5', '2,5', '2e0', '1e2', '-2', '+2', '2 0', 'abc']) {
            fireEvent.change(field, { target: { value } });
            expect(onUpdateSetsCount).not.toHaveBeenCalled();
        }

        fireEvent.change(field, { target: { value: '20' } });
        expect(onUpdateSetsCount).toHaveBeenCalledWith(0, '20');
        onUpdateSetsCount.mockClear();
        fireEvent.change(field, { target: { value: '' } });
        expect(onUpdateSetsCount).toHaveBeenCalledWith(0, '');
    });
});
