import React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, fireEvent, render, renderHook } from '@testing-library/react';
import { BufferedWorkoutScope } from '../../../src/components/UI/bufferedWorkoutScope';
import SessionSetRow from '../../../src/components/Training/session/SessionSetRow';
import SessionExerciseCard from '../../../src/components/Training/session/SessionExerciseCard';
import { useWorkoutSetMutations } from '../../../src/hooks/workout/useWorkoutSetMutations';
import type { WorkoutSession } from '../../../src/types';
import { deviceKey, protectedDeviceKey, readDeviceValueStrict } from '../../../src/lib/sync/deviceStorage';
import { prepareUnlockedTestArchive } from '../../secureVaultFixture';
import { readBufferedDraftSnapshot } from '../../../src/lib/sync/bufferedDraftEpoch';
import { captureSession } from '../../../src/lib/sync/session';
import { useAppStore } from '../../../src/store/useAppStore';
import { localStorageMock } from '../../setup';
import { initialGetItem, initialSetItem } from './bufferedRecoveryFixtures';

describe('advanced workout segment identity across removal and draft recovery', () => {
    const workoutId = 'w-segment-identity';
    const segmentA = { id: 'seg-a', kg: '90', reps: '5', technique: 'cluster' as const };
    const segmentB = { id: 'seg-b', kg: '80', reps: '4', technique: 'cluster' as const };
    const initialSet = {
        id: 'set-identity', kg: '100', reps: '8', technique: 'cluster' as const,
        segments: [segmentA, segmentB],
    };
    const handlers = {
        onToggleMenu: vi.fn(), onRemoveSet: vi.fn(), onUpdateSet: vi.fn(),
        onAddSpecialSet: vi.fn(), onUpdateSpecialSet: vi.fn(),
        onRemoveSpecialSet: vi.fn(), onUpdateSetTarget: vi.fn(),
    };
    const row = (set: typeof initialSet) => (
        <BufferedWorkoutScope.Provider value={workoutId}>
            <SessionSetRow set={set} sIndex={0} exIndex={0} isOpenMenu={false} {...handlers} />
        </BufferedWorkoutScope.Provider>
    );

    beforeEach(() => {
        localStorageMock.getItem.mockImplementation(initialGetItem);
        localStorageMock.setItem.mockImplementation(initialSetItem);
        localStorage.clear();
        vi.clearAllMocks();
        useAppStore.setState({
            localWorkout: { id: workoutId } as WorkoutSession,
            localPersistenceBlocked: false, syncHealth: 'synced',
            syncPresentation: 'normal', saveError: null,
        });
        localStorage.setItem(`logbook:v2:${captureSession().owner}:health-consent-generation`, '3');
    });
    afterEach(() => {
        useAppStore.setState({ localWorkout: null });
        localStorageMock.getItem.mockImplementation(initialGetItem);
        localStorageMock.setItem.mockImplementation(initialSetItem);
        vi.restoreAllMocks();
    });

    it('keeps the later segment DOM and durable recovery key when the earlier dirty segment unmounts', async () => {
        const owner = captureSession().owner;
        await prepareUnlockedTestArchive(owner);
        const nameB = `draft:buffered:input:${workoutId}:seg-kg-set-identity-seg-b`;
        const keyB = protectedDeviceKey(nameB, owner);
        const view = render(row(initialSet));
        const inputA = view.container.querySelector('#seg-kg-set-identity-seg-a') as HTMLInputElement;
        const inputB = view.container.querySelector('#seg-kg-set-identity-seg-b') as HTMLInputElement;
        expect(inputA).not.toBeNull();
        expect(inputB).not.toBeNull();

        fireEvent.change(inputA, { target: { value: '91' } });
        fireEvent.change(inputB, { target: { value: '77' } });
        const bRaw = localStorage.getItem(keyB);
        expect(bRaw).toMatch(/^tlb-sealed:v1:/);
        expect(localStorage.getItem(deviceKey(nameB, owner))).toBeNull();
        expect(JSON.parse(readDeviceValueStrict(nameB, owner)!)).toMatchObject({ value: '77', name: nameB });

        view.rerender(row({ ...initialSet, segments: [segmentB] }));
        const surviving = view.container.querySelector('#seg-kg-set-identity-seg-b') as HTMLInputElement;
        expect(surviving).toBe(inputB);
        expect(surviving.value).toBe('77');
        expect(localStorage.getItem(keyB)).toBe(bRaw);
        expect(handlers.onUpdateSpecialSet).toHaveBeenCalledWith(0, 'set-identity', 'segments', 'seg-a', 'kg', '91');
        fireEvent.blur(surviving);
        expect(handlers.onUpdateSpecialSet).toHaveBeenCalledWith(0, 'set-identity', 'segments', 'seg-b', 'kg', '77');
        expect(localStorage.getItem(keyB)).toBe(bRaw);
        expect(view.container.querySelector('#seg-kg-set-identity-seg-a')).toBeNull();
        view.unmount();
    });

    it('keeps buffered target reps bound to their segment when a preceding dirty target is removed', async () => {
        const owner = captureSession().owner;
        await prepareUnlockedTestArchive(owner);
        let workout: WorkoutSession = {
            id: workoutId,
            exercises: [{ id: 'exercise-a', exId: 'bench', sessionNote: '', sets: [{
                ...initialSet,
                technique: 'rep_match',
                segments: [
                    { ...segmentA, technique: 'rep_match', target: { type: 'reps', reps: 5 } },
                    { ...segmentB, technique: 'rep_match', target: { type: 'reps', reps: 4 } },
                ],
            }] }],
        };
        const setLocalWorkout = (updater: (prev: WorkoutSession | null) => WorkoutSession | null) => {
            workout = updater(workout) ?? workout;
        };
        const { result } = renderHook(() => useWorkoutSetMutations({
            setLocalWorkout, showConfirm: async () => true,
        }));
        const update = vi.fn(result.current.updateSpecialSet);
        const targetRow = () => (
            <BufferedWorkoutScope.Provider value={workoutId}>
                <SessionSetRow set={workout.exercises[0].sets[0]} sIndex={0} exIndex={0}
                    isOpenMenu={false} {...handlers} onUpdateSpecialSet={update} />
            </BufferedWorkoutScope.Provider>
        );
        const view = render(targetRow());
        const inputA = view.container.querySelector('#seg-target-set-identity-seg-a') as HTMLInputElement;
        const inputB = view.container.querySelector('#seg-target-set-identity-seg-b') as HTMLInputElement;
        expect(inputA).not.toBeNull();
        expect(inputB).not.toBeNull();
        fireEvent.change(inputA, { target: { value: '6' } });
        fireEvent.change(inputB, { target: { value: '7' } });
        const nameB = `draft:buffered:input:${workoutId}:seg-target-set-identity-seg-b`;
        const keyB = protectedDeviceKey(nameB, owner);
        const savedDraftB = localStorage.getItem(keyB);
        expect(savedDraftB).toMatch(/^tlb-sealed:v1:/);

        act(() => result.current.removeSpecialSet(0, 'set-identity', 'segments', 'seg-a'));
        view.rerender(targetRow());
        const surviving = view.container.querySelector('#seg-target-set-identity-seg-b') as HTMLInputElement;
        expect(surviving).toBe(inputB);
        expect(surviving.value).toBe('7');
        expect(workout.exercises[0].sets[0].segments).toEqual([
            expect.objectContaining({ id: 'seg-b', target: { type: 'reps', reps: 4 } }),
        ]);
        expect(localStorage.getItem(keyB)).toBe(savedDraftB);
        expect(update).toHaveBeenCalledWith(0, 'set-identity', 'segments', 'seg-a', 'target', { type: 'reps', reps: 6 });

        fireEvent.blur(surviving);
        expect(update).toHaveBeenCalledWith(0, 'set-identity', 'segments', 'seg-b', 'target', { type: 'reps', reps: 7 });
        expect(workout.exercises[0].sets[0].segments).toEqual([
            expect.objectContaining({ id: 'seg-b', target: { type: 'reps', reps: 7 } }),
        ]);
        view.unmount();
    });

    it('refuses a delayed set removal when the selected set, exercise or workout identity moved', () => {
        let workout = {
            id: workoutId, exercises: [{
                id: 'ex-original', exId: 'bench',
                sets: [{ id: 'set-a', kg: '80', reps: '6' }, { id: 'set-b', kg: '90', reps: '5' }],
            }],
        } as unknown as WorkoutSession;
        const setLocalWorkout = (updater: (prev: WorkoutSession | null) => WorkoutSession | null) => {
            workout = updater(workout) ?? workout;
        };
        const { result } = renderHook(() => useWorkoutSetMutations({
            setLocalWorkout, showConfirm: async () => true,
        }));
        workout = { ...workout, exercises: workout.exercises.map(exercise => ({
            ...exercise, sets: [...exercise.sets].reverse(),
        })) };
        const reversed = workout;
        act(() => result.current.removeSet(0, 0, 'set-a', 'ex-original', workoutId));
        expect(workout).toBe(reversed);
        act(() => result.current.removeSet(0, 1, 'set-a', 'ex-other', workoutId));
        expect(workout).toBe(reversed);
        act(() => result.current.removeSet(0, 1, 'set-a', 'ex-original', 'different-workout'));
        expect(workout).toBe(reversed);
        act(() => result.current.removeSet(0, 1, 'set-a', 'ex-original', workoutId));
        expect(workout.exercises[0].sets.map(set => set.id)).toEqual(['set-b']);
    });

    it('ignores an unmounted segment callback and updates only the surviving ID', () => {
        let workout = { id: workoutId, exercises: [{ id: 'exercise-a', exId: 'bench',
            sets: [initialSet] }] } as unknown as WorkoutSession;
        const setLocalWorkout = (updater: (prev: WorkoutSession | null) => WorkoutSession | null) => {
            workout = updater(workout) ?? workout;
        };
        const { result } = renderHook(() => useWorkoutSetMutations({
            setLocalWorkout, showConfirm: async () => true,
        }));
        act(() => result.current.removeSpecialSet(0, 'set-identity', 'segments', 'seg-a'));
        expect(workout.exercises[0].sets[0].segments?.map(x => x.id)).toEqual(['seg-b']);
        const afterRemoval = workout;
        act(() => result.current.updateSpecialSet(0, 'set-identity', 'segments', 'seg-a', 'kg', '999'));
        expect(workout).toBe(afterRemoval);
        act(() => result.current.updateSpecialSet(0, 'set-identity', 'segments', 'seg-b', 'kg', '77'));
        expect(workout.exercises[0].sets[0].segments?.[0]).toMatchObject({ id: 'seg-b', kg: '77' });
    });

});

describe('cardio set identity and buffered draft recovery', () => {
    const workoutId = 'cardio-recovery-workout';
    const exInstanceId = 'se-cardio';
    const onUpdateSet = vi.fn();
    const handlers = {
        onToggleHistory: vi.fn(), onToggleSetup: vi.fn(),
        onRemoveExercise: vi.fn(), onUpdateSessionNote: vi.fn(),
        onUpdateSetupNote: vi.fn(), onUpdateTechnicalStandard: vi.fn(),
        onUpdateSet, onAddSet: vi.fn(), onRemoveSet: vi.fn(),
        onAddSpecialSet: vi.fn(), onUpdateSpecialSet: vi.fn(),
        onRemoveSpecialSet: vi.fn(), onUpdateSetTarget: vi.fn(),
        onToggleSpecialMenu: vi.fn(),
    };
    const card = (setId: string, time: string) => (
        <BufferedWorkoutScope.Provider value={workoutId}>
            <SessionExerciseCard
                exItem={{ id: exInstanceId, exId: 'cardio-run', sessionNote: '', sets: [{ id: setId, kg: '', reps: '', time }] }}
                exIndex={0}
                libDef={{ name: 'Corsa', trackingType: 'cardio' }}
                pastWorkouts={[]} isHistoryOpen={false} isSetupOpen={false}
                openSpecialMenuId={null} {...handlers}
            />
        </BufferedWorkoutScope.Provider>
    );
    const keyFor = (setId: string) =>
        `draft:buffered:input:${workoutId}:cardio-time-${exInstanceId}-${setId}`;

    beforeEach(() => {
        localStorageMock.getItem.mockImplementation(initialGetItem);
        localStorageMock.setItem.mockImplementation(initialSetItem);
        localStorage.clear();
        vi.clearAllMocks();
        useAppStore.setState({ localWorkout: { id: workoutId } as WorkoutSession,
            localPersistenceBlocked: false, syncHealth: 'synced', saveError: null });
        localStorage.setItem(`logbook:v2:${captureSession().owner}:health-consent-generation`, '3');
    });
    afterEach(() => {
        useAppStore.setState({ localWorkout: null });
        localStorageMock.getItem.mockImplementation(initialGetItem);
        localStorageMock.setItem.mockImplementation(initialSetItem);
        vi.restoreAllMocks();
    });

    it('preserves the old cardio set draft while replacing the UI with a different persistent set ID', async () => {
        const owner = captureSession().owner;
        await prepareUnlockedTestArchive(owner);
        const view = render(card('set-old', '8'));
        const input = (id: string) => view.container.querySelector<HTMLInputElement>(`#cardio-time-${exInstanceId}-${id}`);
        fireEvent.change(input('set-old')!, { target: { value: '30' } });
        const oldImage = readBufferedDraftSnapshot(keyFor('set-old'), owner).raw;
        expect(oldImage).toContain('30');
        expect(localStorage.getItem(protectedDeviceKey(keyFor('set-old'), owner))).toMatch(/^tlb-sealed:v1:/);

        view.rerender(card('set-new', '5'));
        expect(input('set-old')).toBeNull();
        expect(input('set-new')?.value).toBe('5');
        expect(readBufferedDraftSnapshot(keyFor('set-old'), owner).raw).toBe(oldImage);
        expect(readBufferedDraftSnapshot(keyFor('set-new'), owner).raw).toBeNull();

        fireEvent.change(input('set-new')!, { target: { value: '10' } });
        expect(readBufferedDraftSnapshot(keyFor('set-new'), owner).value).toBe('10');
        expect(readBufferedDraftSnapshot(keyFor('set-old'), owner).raw).toBe(oldImage);
        expect(onUpdateSet.mock.calls.every(([, setId]) => setId !== undefined)).toBe(true);
        view.unmount();
    });
});

describe('F-001 — stable exercise instance recovery with shared catalog editor boundaries', () => {
    const workoutId = 'w-duplicate-exercises';
    const first = { id: 'se-first', exId: 'bench', sessionNote: '', technicalStandard: '',
        sets: [{ id: 'set-shared', kg: '90', reps: '6' }] };
    const second = { id: 'se-second', exId: 'bench', sessionNote: '', technicalStandard: '',
        sets: [{ id: 'set-shared', kg: '85', reps: '7' }] };
    const onUpdateSetupNote = vi.fn();
    const onUpdateTechnicalStandard = vi.fn();
    const onUpdateSet = vi.fn();
    const handlers = {
        onToggleHistory: vi.fn(), onToggleSetup: vi.fn(),
        onRemoveExercise: vi.fn(), onUpdateSessionNote: vi.fn(),
        onUpdateSetupNote, onUpdateTechnicalStandard, onUpdateSet,
        onAddSet: vi.fn(), onRemoveSet: vi.fn(),
        onAddSpecialSet: vi.fn(), onUpdateSpecialSet: vi.fn(),
        onRemoveSpecialSet: vi.fn(), onUpdateSetTarget: vi.fn(),
        onToggleSpecialMenu: vi.fn(),
    };
    const cards = () => (
        <BufferedWorkoutScope.Provider value={workoutId}>
            {[first, second].map((exItem, exIndex) => (
                <SessionExerciseCard key={exItem.id} exItem={exItem} exIndex={exIndex}
                    libDef={{ name: 'Panca', trackingType: 'weight_reps', notes: 'Setup condiviso' }}
                    pastWorkouts={[]} isHistoryOpen={false} isSetupOpen={true}
                    openSpecialMenuId={null} {...handlers} />
            ))}
        </BufferedWorkoutScope.Provider>
    );
    const input = (container: HTMLElement, id: string) => {
        const field = container.querySelector<HTMLInputElement>(`#${id}`);
        expect(field).not.toBeNull();
        return field!;
    };
    const draftName = (id: string) => `draft:buffered:input:${workoutId}:${id}`;
    const draft = (id: string) => readDeviceValueStrict(draftName(id), captureSession().owner);
    const sealedDraft = (id: string) =>
        localStorage.getItem(protectedDeviceKey(draftName(id), captureSession().owner));

    beforeEach(() => {
        localStorageMock.getItem.mockImplementation(initialGetItem);
        localStorageMock.setItem.mockImplementation(initialSetItem);
        localStorage.clear();
        vi.clearAllMocks();
        useAppStore.setState({
            localWorkout: { id: workoutId } as WorkoutSession,
            localPersistenceBlocked: false, syncHealth: 'synced',
            syncPresentation: 'normal', saveError: null,
        });
        localStorage.setItem(`logbook:v2:${captureSession().owner}:health-consent-generation`, '3');
    });
    afterEach(() => {
        useAppStore.setState({ localWorkout: null });
        localStorageMock.getItem.mockImplementation(initialGetItem);
        localStorageMock.setItem.mockImplementation(initialSetItem);
        vi.restoreAllMocks();
    });

    it('saves and recovers two different standards and equal set IDs without collision', async () => {
        await prepareUnlockedTestArchive(captureSession().owner);
        const view = render(cards());
        const values = [
            ['technical-standard-se-first', 'Prima: fermo 2 s'],
            ['technical-standard-se-second', 'Seconda: fermo 1 s'],
             ['se-first-kg-set-shared', '91'],
            ['se-second-kg-set-shared', '86'],
        ] as const;
        for (const [id, value] of values) fireEvent.change(input(view.container, id), { target: { value } });
        for (const [id, value] of values) {
            expect(JSON.parse(draft(id)!)).toMatchObject({
                name: draftName(id), value,
            });
            expect(sealedDraft(id)).toMatch(/^tlb-sealed:v1:/);
            expect(localStorage.getItem(deviceKey(draftName(id), captureSession().owner))).toBeNull();
        }
        const sealedBeforeRemount = values.map(([id]) => sealedDraft(id));
        // Setup UI is per-instance, but both editors write one catalog item.
        expect(input(view.container, 'setup-se-first')).not.toBe(input(view.container, 'setup-se-second'));
        expect(input(view.container, 'setup-se-first').value).toBe('Setup condiviso');
        expect(input(view.container, 'setup-se-second').value).toBe('Setup condiviso');
        expect(useAppStore.getState().localPersistenceBlocked).toBe(false);
        // React unmount flushes editor callbacks, but business acknowledgment is
        // intentionally withheld, modeling a reload before commit confirmation.
        view.unmount();
        const reopened = render(cards());
        for (const [index, [id, value]] of values.entries()) {
            expect(input(reopened.container, id).value).toBe(value);
            expect(JSON.parse(draft(id)!)).toMatchObject({ value });
            expect(sealedDraft(id)).toBe(sealedBeforeRemount[index]);
        }
        expect(useAppStore.getState().localPersistenceBlocked).toBe(false);
        reopened.unmount();
    });

    it('preserves one shared catalog recovery target and rejects a conflicting second editor', async () => {
        await prepareUnlockedTestArchive(captureSession().owner);
        const view = render(cards());
        const firstSetup = input(view.container, 'setup-se-first');
        const secondSetup = input(view.container, 'setup-se-second');
        const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});
        fireEvent.change(firstSetup, { target: { value: 'Catalog change 1' } });
        fireEvent.blur(firstSetup);
        const sharedRaw = draft('setup-bench');
        const sharedCiphertext = sealedDraft('setup-bench');
        expect(JSON.parse(sharedRaw!)).toMatchObject({ value: 'Catalog change 1' });
        expect(sharedCiphertext).toMatch(/^tlb-sealed:v1:/);
        expect(localStorage.getItem(deviceKey(draftName('setup-bench'), captureSession().owner))).toBeNull();
        expect(onUpdateSetupNote).toHaveBeenCalledExactlyOnceWith('bench', 'Catalog change 1');
        // A second concurrently mounted editor cannot publish a stale
        // alternative under the same catalog field without reconciliation.
        fireEvent.change(secondSetup, { target: { value: 'Catalog change 2' } });
        fireEvent.blur(secondSetup);
        expect(draft('setup-bench')).toBe(sharedRaw);
        expect(sealedDraft('setup-bench')).toBe(sharedCiphertext);
        expect(onUpdateSetupNote).toHaveBeenCalledTimes(1);
        expect(useAppStore.getState().localPersistenceBlocked).toBe(true);
        expect(consoleError).toHaveBeenCalled();
        view.unmount();
    });
});
