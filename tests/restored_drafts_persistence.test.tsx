import { renderHook } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { useTrainingExercises } from '../src/hooks/useTrainingExercises';
import { useTrainingRoutines } from '../src/hooks/useTrainingRoutines';
import { deviceKey } from '../src/lib/sync/deviceStorage';
import { storageOwner } from '../src/lib/sync/session';

describe('restored owner-scoped drafts', () => {
    beforeEach(() => localStorage.clear());

    it('does not clear the exercise draft before hydration is reflected in React state', () => {
        const key = deviceKey('draft_exercise', storageOwner());
        const draft = JSON.stringify({
            name: 'Draft exercise', notes: 'Keep me',
            trackingType: 'weight_reps', selectedMuscles: [], secondaryMuscles: [],
            isBodyweight: false, equipmentWeight: '20',
        });
        localStorage.setItem(key, draft);
        const remove = vi.spyOn(Storage.prototype, 'removeItem');
        try {
            const { result, unmount } = renderHook(() => useTrainingExercises());
            expect(result.current.exName).toBe('Draft exercise');
            expect(localStorage.getItem(key)).not.toBeNull();
            expect(remove).not.toHaveBeenCalledWith(key);
            unmount();
        } finally {
            remove.mockRestore();
        }
    });

    it('does not clear the routine draft before hydration is reflected in React state', () => {
        const key = deviceKey('draft_routine', storageOwner());
        const draft = JSON.stringify({ name: 'Draft routine', exercises: [] });
        localStorage.setItem(key, draft);
        const remove = vi.spyOn(Storage.prototype, 'removeItem');
        try {
            const { result, unmount } = renderHook(() => useTrainingRoutines());
            expect(result.current.routineName).toBe('Draft routine');
            expect(localStorage.getItem(key)).not.toBeNull();
            expect(remove).not.toHaveBeenCalledWith(key);
            unmount();
        } finally {
            remove.mockRestore();
        }
    });
});
