import React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, fireEvent, render, renderHook, screen, waitFor } from '@testing-library/react';
import { useAppStore } from '../src/store/useAppStore';
import { useDialogStore } from '../src/store/useDialogStore';
import { UserDataSchema } from '../src/lib/schema';
import type { WorkoutSession, UserData } from '../src/types';
import { deviceKey } from '../src/lib/sync/deviceStorage';
import { captureSession } from '../src/lib/sync/session';
import { getInitialLocalWorkout } from '../src/store/slices/createWorkoutSlice';
import { readWorkoutTimerSnapshot } from '../src/lib/utils/timer';
import PreSessionCheckIn from '../src/components/Training/PreSessionCheckIn';
import TrainingSession from '../src/components/Training/TrainingSession';
import WorkoutTimer from '../src/components/Training/WorkoutTimer';
import { useWorkoutSession } from '../src/hooks/useWorkoutSession';
import { localStorageMock, renderWithProviders } from './setup';

function workout(id: string, started = false): WorkoutSession {
    return {
        id, date: '2026-10-09', routineName: 'Workout',
        ...(started ? { globalStartTime: Date.now() - 60_000 } : {}),
        exercises: [{ id: 'se1', exId: 'bench', name: 'Panca',
            sets: [{ id: 's1', reps: '8', kg: '50' }] }],
    };
}
function userData(data: Partial<UserData>): UserData {
    return UserDataSchema.parse(data) as unknown as UserData;
}

describe('Workout lifecycle durable recovery regressions', () => {
    let owner: string;
    beforeEach(() => {
        localStorage.clear();
        vi.clearAllMocks();
        owner = captureSession().owner;
        useAppStore.setState({
            userData: userData({}), dataOwner: owner, localWorkout: null,
            localPersistenceBlocked: false, syncHealth: 'synced',
            syncPresentation: 'normal', syncing: false, saveError: null,
            compatibilityStatus: 'ok',
        });
    });
    afterEach(() => vi.restoreAllMocks());

    it('keeps unreadable timer storage intact and blocks controls after React mount', () => {
        const key = deviceKey('timer', owner);
        localStorage.setItem(key, '{bad-json');
        renderWithProviders(<React.StrictMode><WorkoutTimer /></React.StrictMode>);
        expect(localStorage.getItem(key)).toBe('{bad-json');
        expect(useAppStore.getState().localPersistenceBlocked).toBe(true);
        expect(screen.getByRole('button', { name: 'Avvia recupero' }).hasAttribute('disabled')).toBe(true);
    });

    it('keeps readiness UI and durable draft unchanged when a write fails', () => {
        render(<PreSessionCheckIn workoutId="readiness-1" onStart={vi.fn(async () => true)}
            onCancel={vi.fn(async () => true)} />);
        fireEvent.click(screen.getByRole('button', { name: 'Energia: 4 su 5' }));
        expect(screen.getByRole('button', { name: 'Energia: 4 su 5' }).getAttribute('aria-pressed')).toBe('true');
        const key = deviceKey('draft:pre-session:readiness-1', owner);
        const previous = localStorage.getItem(key);
        localStorageMock.setItem.mockImplementationOnce((written: string) => {
            if (written === key) throw new DOMException('full', 'QuotaExceededError');
        });
        fireEvent.click(screen.getByRole('button', { name: 'Energia: 5 su 5' }));
        expect(screen.getByRole('button', { name: 'Energia: 4 su 5' }).getAttribute('aria-pressed')).toBe('true');
        expect(localStorage.getItem(key)).toBe(previous);
    });

    it('preserves readiness draft if deletion is declined', async () => {
        const cancel = vi.fn(async () => false);
        render(<PreSessionCheckIn workoutId="readiness-2" onStart={vi.fn(async () => true)} onCancel={cancel} />);
        fireEvent.click(screen.getByRole('button', { name: 'Motivazione: 3 su 5' }));
        const key = deviceKey('draft:pre-session:readiness-2', owner);
        const saved = localStorage.getItem(key);
        fireEvent.click(screen.getByRole('button', { name: 'Annulla allenamento' }));
        await waitFor(() => expect(cancel).toHaveBeenCalledOnce());
        expect(localStorage.getItem(key)).toBe(saved);
    });

    it('returns false when workout deletion confirmation is declined', async () => {
        const pending = workout('keep');
        useAppStore.setState({ userData: userData({ activeWorkout: pending }), localWorkout: pending });
        vi.mocked(useDialogStore.getState().showConfirm).mockResolvedValueOnce(false);
        const { result } = renderHook(() => useWorkoutSession());
        let deleted = true;
        await act(async () => { deleted = await result.current.deleteWorkout(); });
        expect(deleted).toBe(false);
        expect(useAppStore.getState().localWorkout?.id).toBe('keep');
    });

    it('suspends and restores an active workout without clearing its timer or cloud shadow', async () => {
        const active = workout('active', true);
        const old = workout('historical', true);
        const initialTimer = { version: 1, state: 'running', startTime: 1000, accumulated: 0 };
        localStorage.setItem(deviceKey('timer', owner), JSON.stringify(initialTimer));
        localStorage.setItem(deviceKey('workout', owner), JSON.stringify(active));
        useAppStore.setState({ userData: userData({ activeWorkout: active, history: [old] }), localWorkout: active });
        const { result } = renderHook(() => useWorkoutSession());

        let started = false;
        await act(async () => { started = await result.current.startEditHistoricalWorkout(old); });
        expect(started).toBe(true);
        expect(useAppStore.getState().localWorkout?.isEditingHistory).toBe(true);
        expect(useAppStore.getState().userData?.activeWorkout?.id).toBe('active');
        expect(readWorkoutTimerSnapshot(owner)).toEqual(initialTimer);

        // Rehydrate from the owner-scoped device snapshot while the editor is open.
        const reopened = getInitialLocalWorkout(owner, active, [old]);
        expect(reopened?.isEditingHistory).toBe(true);
        useAppStore.setState({ localWorkout: reopened });

        let canceled = false;
        await act(async () => { canceled = await result.current.cancelHistoryEdit(); });
        expect(canceled).toBe(true);
        expect(useAppStore.getState().localWorkout?.id).toBe('active');
        expect(getInitialLocalWorkout(owner, active, [old])?.id).toBe('active');
        expect(readWorkoutTimerSnapshot(owner)).toEqual(initialTimer);
    });

    it('restores a durable active shadow when the transient device state was absent', async () => {
        const active = workout('shadow', true);
        const old = workout('old-shadow', true);
        useAppStore.setState({ userData: userData({ activeWorkout: active, history: [old] }), localWorkout: null });
        const { result } = renderHook(() => useWorkoutSession());
        await act(async () => { expect(await result.current.startEditHistoricalWorkout(old)).toBe(true); });
        await act(async () => { expect(await result.current.cancelHistoryEdit()).toBe(true); });
        expect(useAppStore.getState().localWorkout?.id).toBe('shadow');
    });

    it('does not stop an active timer if switching to the historical editor fails', async () => {
        const active = workout('original', true);
        const old = workout('old', true);
        localStorage.setItem(deviceKey('timer', owner),
            JSON.stringify({ version: 1, state: 'running', startTime: 1000, accumulated: 0 }));
        useAppStore.setState({ userData: userData({ activeWorkout: active, history: [old] }), localWorkout: active });
        const key = deviceKey('workout', owner);
        // Context and workout are separate owner-scoped writes. Fail only the
        // second write so no persistent mock leaks into subsequent cases.
        localStorageMock.setItem.mockImplementationOnce(() => undefined);
        localStorageMock.setItem.mockImplementationOnce((written: string) => {
            if (written === key) throw new DOMException('blocked', 'SecurityError');
        });
        const { result } = renderHook(() => useWorkoutSession());
        // Failure may hit context write first; either way the original timer stays live.
        let started = true;
        await act(async () => { started = await result.current.startEditHistoricalWorkout(old); });
        expect(started).toBe(false);
        expect(readWorkoutTimerSnapshot(owner).state).toBe('running');
        expect(useAppStore.getState().localWorkout?.id).toBe('original');
    });

    it('does not resurrect a completed session from a stale device snapshot', () => {
        const finished = workout('completed', true);
        localStorage.setItem(deviceKey('workout', owner), JSON.stringify(finished));
        expect(getInitialLocalWorkout(owner, null, [finished])).toBeNull();
        expect(localStorage.getItem(deviceKey('workout', owner))).toBeNull();
    });

    it('does not discard an unfinished device-only workout while history is unrelated', () => {
        const prepared = workout('prepared');
        localStorage.setItem(deviceKey('workout', owner), JSON.stringify(prepared));
        expect(getInitialLocalWorkout(owner, null, [workout('other', true)])?.id).toBe('prepared');
    });

    it('keeps post-session rating unchanged if its synchronous persistence fails', () => {
        const active = workout('post-write', true);
        useAppStore.setState({ userData: userData({ activeWorkout: active }), localWorkout: active });
        render(<TrainingSession />);
        fireEvent.click(screen.getByRole('button', { name: 'Termina allenamento' }));
        const key = deviceKey('draft:post-session:post-write', owner);
        const previous = localStorage.getItem(key);
        localStorageMock.setItem.mockImplementationOnce((written: string) => {
            if (written === key) throw new DOMException('full', 'QuotaExceededError');
        });
        fireEvent.click(screen.getByRole('button', { name: 'Umore: 5 su 5' }));
        expect(screen.getByRole('button', { name: 'Umore: 5 su 5' }).getAttribute('aria-pressed')).toBe('false');
        expect(localStorage.getItem(key)).toBe(previous);
    });
});
