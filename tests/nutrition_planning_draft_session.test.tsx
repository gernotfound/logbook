import { act, cleanup, render, renderHook, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useNutritionPlanning } from '../src/hooks/useNutritionPlanning';
import NutritionPlanning from '../src/components/Nutrition/NutritionPlanning';
import { captureSession, invalidateSession } from '../src/lib/sync/session';
import { UserDataSchema } from '../src/lib/schema';
import { useAppStore } from '../src/store/useAppStore';
import type { UserData } from '../src/types';

const plan = (weight: number) => ({
    weight,
    onDaysCount: 4,
    avgMacros: { carbsPerKg: 3.5, proPerKg: 2, fatPerKg: 1 },
    onBoost: { carbsPercent: 20, proPercent: 0, fatPercent: 0 },
    normocalorica: { kcal: 2500, carbs: 300, pro: 160, fat: 70 },
});
const data = (weight: number) => UserDataSchema.parse({ nutritionPlanning: plan(weight) }) as UserData;
let originalDispatch: ReturnType<typeof useAppStore.getState>['dispatchDomainOperation'];

beforeEach(() => {
    originalDispatch = useAppStore.getState().dispatchDomainOperation;
    useAppStore.setState({
        userData: data(75),
        dataOwner: captureSession().owner,
        localPersistenceBlocked: false,
        dispatchDomainOperation: vi.fn(async () => ({ ok: true as const, status: 'synced' as const })),
    });
});
afterEach(() => {
    cleanup();
    useAppStore.setState({ dispatchDomainOperation: originalDispatch });
});

describe('nutrition planning edits and session ownership', () => {
    it('associates the visible notes label with its textarea', () => {
        render(<NutritionPlanning />);
        const notes = screen.getByRole('textbox', { name: /Note/ });
        expect((notes as HTMLTextAreaElement).id).toBe('nutrition-planning-notes');
    });

    it('composes separate fields edited before React rerenders', () => {
        const { result } = renderHook(() => useNutritionPlanning());
        act(() => {
            result.current.handleUpdateAvgMacros('carbsPerKg', '4.5');
            result.current.handleUpdateOnBoost('fatPercent', '25');
            result.current.handleUpdate('weight', '81');
        });
        expect(result.current.planning.avgMacros?.carbsPerKg).toBe(4.5);
        expect(result.current.planning.onBoost?.fatPercent).toBe(25);
        expect(result.current.planning.weight).toBe('81');
    });

    it('ignores an old account epoch during a pending save without clearing newer edits', async () => {
        let resolve!: (result: { ok: true; status: 'synced' }) => void;
        const pendingCommit = new Promise<{ ok: true; status: 'synced' }>(done => { resolve = done; });
        const dispatch = vi.fn(() => pendingCommit);
        useAppStore.setState({ dispatchDomainOperation: dispatch });
        const { result } = renderHook(() => useNutritionPlanning());
        act(() => result.current.handleUpdate('weight', '90'));
        let firstSave!: Promise<void>;
        act(() => { firstSave = result.current.handleSave(); });
        expect(dispatch).toHaveBeenCalledOnce();
        expect(result.current.saveStatus).toBe('saving');

        // The same owner can log out and return: UID equality alone is not continuity.
        invalidateSession();
        act(() => useAppStore.setState({ userData: data(65) }));
        expect(result.current.planning.weight).toBe(65);
        expect(result.current.saveStatus).toBe('idle');

        act(() => result.current.handleUpdate('weight', '66'));
        await act(async () => {
            resolve({ ok: true, status: 'synced' });
            await firstSave;
        });
        expect(result.current.planning.weight).toBe('66');
        expect(result.current.saveStatus).toBe('unsaved');
    });

    it('preserves an explicitly invalid zero weight and refuses substituted persistence', async () => {
        const dispatch = vi.fn(async () => ({ ok: true as const, status: 'synced' as const }));
        useAppStore.setState({ dispatchDomainOperation: dispatch });
        const { result } = renderHook(() => useNutritionPlanning());
        act(() => result.current.handleUpdate('weight', 0));
        expect(result.current.planning.weight).toBe(0);
        await act(async () => { await result.current.handleSave(); });
        expect(dispatch).not.toHaveBeenCalled();
        expect(result.current.saveStatus).toBe('unsaved');
    });

    it('does not stage or submit another owner\'s planning when hydration has not switched', async () => {
        const dispatch = vi.fn(async () => ({ ok: true as const, status: 'synced' as const }));
        useAppStore.setState({ dataOwner: 'user:different', dispatchDomainOperation: dispatch });
        const { result } = renderHook(() => useNutritionPlanning());
        expect(result.current.planning.weight).toBe(80);
        act(() => result.current.handleUpdate('weight', '99'));
        expect(result.current.planning.weight).toBe(80);
        await act(async () => { await result.current.handleSave(); });
        expect(dispatch).not.toHaveBeenCalled();
    });
});
