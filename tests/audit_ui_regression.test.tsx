import { deviceKey } from '../src/lib/sync/deviceStorage';
import React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, renderHook, screen } from '@testing-library/react';
import { emptyUserData } from './setup';
import { useAppStore } from '../src/store/useAppStore';
import { useWorkoutSession } from '../src/hooks/useWorkoutSession';
import { useNutritionPlanning } from '../src/hooks/useNutritionPlanning';
import { DB } from '../src/lib/db';
import { useDialogStore } from '../src/store/useDialogStore';
import { GlobalDialog } from '../src/components/UI/GlobalDialog';
import { clearSyncTimers } from '../src/store/slices/createSyncSlice';
import { clearWorkoutTimer } from '../src/store/slices/createWorkoutSlice';

// Exercise the actual dialog store; Firebase remains mocked at the network boundary.
vi.unmock('../src/store/useDialogStore');
const workout = { id: 'w-audit', date: '2026-09-10', routineName: 'Test', exercises: [], globalStartTime: 1000 };

beforeEach(() => {
    vi.useFakeTimers();
    localStorage.clear();
    useAppStore.setState({ userData: { ...emptyUserData, history: [], activeWorkout: workout }, localWorkout: workout, syncing: false, syncHealth: 'synced' });
    vi.mocked(DB.saveUserData).mockResolvedValue({ ok: true, status: 'synced' });
});
afterEach(() => {
    cleanup();
    clearSyncTimers();
    clearWorkoutTimer();
    useDialogStore.getState().onCancel();
    vi.restoreAllMocks();
    vi.useRealTimers();
});

describe('audit interaction regressions', () => {
    it('traps focus, cancels with Escape and restores the launching control', async () => {
        const { container } = render(<><button>Apri</button><GlobalDialog /></>);
        const opener = screen.getByText('Apri');
        opener.focus();
        let confirmation!: Promise<boolean>;
        act(() => { confirmation = useDialogStore.getState().showConfirm('Procedere?'); });
        const cancel = screen.getByText('Annulla');
        const confirm = screen.getByRole('button', { name: 'Conferma' });
        expect(document.activeElement).toBe(cancel);
        expect(container.inert).toBe(true);
        fireEvent.keyDown(cancel, { key: 'Tab', shiftKey: true });
        expect(document.activeElement).toBe(confirm);
        fireEvent.keyDown(confirm, { key: 'Tab' });
        expect(document.activeElement).toBe(cancel);
        fireEvent.keyDown(cancel, { key: 'Escape' });
        expect(await confirmation).toBe(false);
        expect(document.activeElement).toBe(opener);
        expect(container.inert).not.toBe(true);
    });

    it('does not offer safe exit while a save is still running', () => {
        useAppStore.setState({ syncing: true, syncHealth: 'synced' });
        render(<GlobalDialog />);
        act(() => { void useDialogStore.getState().showUnsyncedDataLogout('offline'); });
        expect(screen.queryByText('Esci in sicurezza')).toBeNull();
    });

    it('removes a completed local workout immediately, before a timer or background event', () => {
        localStorage.setItem(deviceKey('workout'), JSON.stringify(workout));
        act(() => useAppStore.getState().setLocalWorkout(null));
        expect(localStorage.getItem(deviceKey('workout'))).toBeNull();
        act(() => vi.advanceTimersByTime(1000));
        expect(localStorage.getItem(deviceKey('workout'))).toBeNull();
    });

    it('does not confirm completion when synchronous storage removal fails', () => {
        vi.spyOn(localStorage, 'removeItem').mockImplementationOnce(() => { throw new Error('Storage unavailable'); });
        expect(() => useAppStore.getState().setLocalWorkout(null)).toThrow('Storage unavailable');
        expect(useAppStore.getState().localWorkout?.id).toBe(workout.id);
    });

    it('ends a workout once even after double submission and a rejected first save', async () => {
        vi.spyOn(useDialogStore.getState(), 'showConfirm').mockResolvedValue(true);
        vi.spyOn(useDialogStore.getState(), 'showAlert').mockResolvedValue();
        vi.mocked(DB.saveUserData).mockResolvedValueOnce({ ok: false, status: 'rejected' });
        const { result } = renderHook(() => useWorkoutSession());
        let first!: Promise<unknown>;
        let duplicate!: Promise<unknown>;
        await act(async () => {
            first = result.current.endWorkout();
            duplicate = result.current.endWorkout();
            await vi.advanceTimersByTimeAsync(1100);
        });
        expect(await first).toBeNull();
        expect(await duplicate).toBeNull();
        expect(useAppStore.getState().localWorkout?.id).toBe(workout.id);
        let retry!: Promise<unknown>;
        await act(async () => {
            retry = result.current.endWorkout();
            await vi.advanceTimersByTimeAsync(1100);
        });
        expect(await retry).toMatchObject({ id: workout.id });
        expect(useAppStore.getState().userData?.history.filter(item => item.id === workout.id)).toHaveLength(1);
        expect(useAppStore.getState().localWorkout).toBeNull();
    });

    it('persists zero ON days through the planning form save', async () => {
        vi.spyOn(useDialogStore.getState(), 'showAlert').mockResolvedValue();
        const { result } = renderHook(() => useNutritionPlanning());
        act(() => result.current.handleUpdate('onDaysCount', 0));
        let save!: Promise<void>;
        await act(async () => {
            save = result.current.handleSave();
            await vi.advanceTimersByTimeAsync(1100);
        });
        await save;
        expect(useAppStore.getState().userData?.nutritionPlanning?.onDaysCount).toBe(0);
    });
});
