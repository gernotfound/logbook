import { act, renderHook, waitFor } from '@testing-library/react';
import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest';
import { useTrainingExercises } from '../../../src/hooks/useTrainingExercises';
import { useTrainingRoutines } from '../../../src/hooks/useTrainingRoutines';
import { deviceKey, protectedDeviceKey, readDeviceValueStrict, writeDeviceValue } from '../../../src/lib/sync/deviceStorage';
import { writeWorkoutRecoveryDraft } from '../../../src/lib/sync/workoutRecoveryDraft';
import { prepareUnlockedTestArchive } from '../../secureVaultFixture';
import { localStorageMock } from '../../setup';
import { useAppStore } from '../../../src/store/useAppStore';
import { useDialogStore } from '../../../src/store/useDialogStore';
import { UserDataSchema } from '../../../src/lib/schema';
import { initializeLocal, readLocal } from '../../../src/lib/sync/localRepository';
import type { UserData } from '../../../src/types';
import { storageOwner } from '../../../src/lib/sync/session';

const initialStorageWrite = localStorageMock.setItem.getMockImplementation()!;

describe('restored owner-scoped drafts', () => {
    beforeEach(async () => {
        localStorageMock.setItem.mockImplementation(initialStorageWrite);
        localStorage.clear();
        await prepareUnlockedTestArchive(storageOwner());
        localStorage.setItem(`logbook:v2:${storageOwner()}:health-consent-generation`, '3');
        const initial = UserDataSchema.parse({}) as UserData;
        await initializeLocal(storageOwner(), initial);
        useAppStore.setState({
            userData: initial, dataOwner: storageOwner(),
            localPersistenceBlocked: false, syncHealth: 'synced', saveError: null,
        });
    });
    afterEach(() => vi.restoreAllMocks());

    it('does not clear the exercise draft before hydration is reflected in React state', () => {
        const key = deviceKey('draft_exercise', storageOwner());
        const draft = JSON.stringify({
            name: 'Draft exercise', notes: 'Keep me',
            trackingType: 'weight_reps', selectedMuscles: [], secondaryMuscles: [],
            isBodyweight: false, equipmentWeight: '20',
        });
        writeWorkoutRecoveryDraft('draft_exercise', storageOwner(), JSON.parse(draft));
        const remove = vi.spyOn(localStorageMock, 'removeItem');
        try {
            const { result, unmount } = renderHook(() => useTrainingExercises());
            expect(result.current.exName).toBe('Draft exercise');
            expect(localStorage.getItem(key)).toBeNull();
            expect(localStorage.getItem(protectedDeviceKey('draft_exercise', storageOwner()))).toMatch(/^tlb-sealed:v1:/);
            expect(JSON.parse(readDeviceValueStrict('draft_exercise', storageOwner())!)).toMatchObject({
                __logbookWorkoutRecoveryDraft: 1, owner: storageOwner(), name: 'draft_exercise',
                consentRevision: 3, data: JSON.parse(draft),
            });
            expect(remove).not.toHaveBeenCalledWith(protectedDeviceKey('draft_exercise', storageOwner()));
            unmount();
        } finally {
            remove.mockRestore();
        }
    });

    it.each(['exercise', 'routine'] as const)(
        'does not reseal a confirmed %s recovery draft without new input',
        kind => {
            const owner = storageOwner();
            const name = kind === 'exercise' ? 'draft_exercise' : 'draft_routine';
            const payload = kind === 'exercise' ? {
                name: 'Unchanged exercise', notes: 'Keep witness',
                trackingType: 'weight_reps', selectedMuscles: [], secondaryMuscles: [],
                isBodyweight: false, equipmentWeight: '',
            } : { name: 'Unchanged routine', exercises: [] };
            const initialRaw = writeWorkoutRecoveryDraft(name, owner, payload, '3');
            const key = protectedDeviceKey(name, owner);
            const originalSealed = localStorage.getItem(key);
            const editor = kind === 'exercise'
                ? renderHook(() => useTrainingExercises())
                : renderHook(() => useTrainingRoutines());
            editor.rerender();
            expect(readDeviceValueStrict(name, owner)).toBe(initialRaw);
            expect(localStorage.getItem(key)).toBe(originalSealed);
            expect(writeWorkoutRecoveryDraft(name, owner, payload, '3', initialRaw)).toBe(initialRaw);
            expect(localStorage.getItem(key)).toBe(originalSealed);
            editor.unmount();

            // An equal payload from an old epoch must still fail closed.
            localStorage.setItem(`logbook:v2:${owner}:health-consent-generation`, '4');
            expect(() => writeWorkoutRecoveryDraft(name, owner, payload, '3', initialRaw))
                .toThrow();
            expect(localStorage.getItem(key)).toBe(originalSealed);
        },
    );

    it('does not clear the routine draft before hydration is reflected in React state', () => {
        const key = deviceKey('draft_routine', storageOwner());
        const draft = JSON.stringify({ name: 'Draft routine', exercises: [] });
        writeWorkoutRecoveryDraft('draft_routine', storageOwner(), JSON.parse(draft));
        const remove = vi.spyOn(localStorageMock, 'removeItem');
        try {
            const { result, unmount } = renderHook(() => useTrainingRoutines());
            expect(result.current.routineName).toBe('Draft routine');
            expect(localStorage.getItem(key)).toBeNull();
            expect(localStorage.getItem(protectedDeviceKey('draft_routine', storageOwner()))).toMatch(/^tlb-sealed:v1:/);
            expect(JSON.parse(readDeviceValueStrict('draft_routine', storageOwner())!)).toMatchObject({
                __logbookWorkoutRecoveryDraft: 1, owner: storageOwner(), name: 'draft_routine',
                consentRevision: 3, data: JSON.parse(draft),
            });
            expect(remove).not.toHaveBeenCalledWith(protectedDeviceKey('draft_routine', storageOwner()));
            unmount();
        } finally {
            remove.mockRestore();
        }
    });
    it.each([
        ['invalid name', { name: 88, exercises: [] }],
        ['invalid exercise collection', { name: 'Bozza', exercises: {} }],
        ['invalid set plans', { name: 'Bozza', exercises: [{ exId: 'exercise-a', setsCount: 3, setPlans: {} }] }],
        ['invalid default technique', { name: 'Bozza', exercises: [{ exId: 'exercise-a', setsCount: 3, defaultTechnique: 'unknown' }] }],
        ['invalid progression contract', { name: 'Bozza', exercises: [{ exId: 'exercise-a', setsCount: 3, progressionContract: { role: 'owner' } }] }],
    ])('preserves corrupted %s in an authenticated routine draft', async (_description, corrupted) => {
        const owner = storageOwner();
        writeWorkoutRecoveryDraft('draft_routine', owner, corrupted);
        const sealedKey = protectedDeviceKey('draft_routine', owner);
        const original = localStorage.getItem(sealedKey);
        const editor = renderHook(() => useTrainingRoutines());
        expect(useAppStore.getState().localPersistenceBlocked).toBe(true);
        expect(editor.result.current.handleCancelEdit()).toBe(false);
        expect(localStorage.getItem(sealedKey)).toBe(original);
        editor.unmount();
    });

    it('retains the last sealed exercise draft and refuses business save when a later physical write fails', async () => {
        const owner = storageOwner();
        writeWorkoutRecoveryDraft('draft_exercise', owner, { name: 'Recovered exercise', notes: 'Last durable note' });
        const hook = renderHook(() => useTrainingExercises());
        const key = protectedDeviceKey('draft_exercise', owner);
        const before = localStorage.getItem(key);
        const originalSet = localStorageMock.setItem.getMockImplementation()!;
        const dispatch = vi.spyOn(useAppStore.getState(), 'dispatchDomainOperation');
        vi.spyOn(useDialogStore.getState(), 'showAlert').mockResolvedValue(undefined);
        vi.spyOn(localStorageMock, 'setItem').mockImplementation((name, value) => {
            if (name === key) throw new DOMException('storage full', 'QuotaExceededError');
            originalSet(name, value);
        });

        act(() => hook.result.current.setExNotes('Only in memory'));
        expect(hook.result.current.exNotes).toBe('Only in memory');
        expect(useAppStore.getState().localPersistenceBlocked).toBe(true);
        expect(localStorage.getItem(key)).toBe(before);
        await act(async () => { expect(await hook.result.current.handleSaveExercise()).toBe(false); });
        expect(dispatch).not.toHaveBeenCalled();
        expect((await readLocal(owner))?.data.library).toEqual([]);
        expect(localStorage.getItem(key)).toBe(before);
        hook.unmount();
    });

    it('commits an edited restored exercise through the durable domain boundary before clearing its draft', async () => {
        const owner = storageOwner();
        writeWorkoutRecoveryDraft('draft_exercise', owner, {
            name: 'Recovered exercise', notes: 'Recovered note',
            trackingType: 'weight_reps', selectedMuscles: [], secondaryMuscles: [],
            isBodyweight: false, equipmentWeight: '20',
        });
        const hook = renderHook(() => useTrainingExercises());
        expect(hook.result.current.exName).toBe('Recovered exercise');
        act(() => hook.result.current.setExNotes('Edited after recovery'));
        await act(async () => { expect(await hook.result.current.handleSaveExercise()).toBe(true); });

        const durable = await readLocal(owner);
        expect(durable?.data.library).toEqual([
            expect.objectContaining({ name: 'Recovered exercise', notes: 'Edited after recovery', equipmentWeight: 20 }),
        ]);
        expect(durable?.pending.length).toBeGreaterThan(0);
        expect(readDeviceValueStrict('draft_exercise', owner)).toBeNull();
        expect(hook.result.current.exName).toBe('');
        hook.unmount();
    });

    it('commits an edited restored routine before clearing its temporary copy', async () => {
        const owner = storageOwner();
        writeWorkoutRecoveryDraft('draft_routine', owner, { name: 'Recovered routine', exercises: [] });
        const hook = renderHook(() => useTrainingRoutines());
        expect(hook.result.current.routineName).toBe('Recovered routine');
        act(() => hook.result.current.setRoutineName('Edited recovered routine'));
        await act(async () => { expect(await hook.result.current.handleSave()).toBe(true); });

        const durable = await readLocal(owner);
        expect(durable?.data.routines).toEqual([
            expect.objectContaining({ name: 'Edited recovered routine', exercises: [] }),
        ]);
        expect(durable?.pending.length).toBeGreaterThan(0);
        expect(readDeviceValueStrict('draft_routine', owner)).toBeNull();
        expect(hook.result.current.routineName).toBe('');
        hook.unmount();
    });

    it.each(['routine', 'exercise'] as const)(
        'preserves a concurrent %s draft and rejects a stale editor save or cleanup',
        async kind => {
            const owner = storageOwner();
            const name = kind === 'routine' ? 'draft_routine' : 'draft_exercise';
            const first = kind === 'routine'
                ? { name: 'Bozza iniziale', exercises: [] }
                : { name: 'Bozza iniziale', notes: '', trackingType: 'weight_reps',
                    selectedMuscles: [], secondaryMuscles: [], isBodyweight: false, equipmentWeight: '' };
            writeWorkoutRecoveryDraft(name, owner, first);
            const dispatch = vi.fn(async () => ({ ok: true as const, status: 'synced' as const }));
            const oldDispatch = useAppStore.getState().dispatchDomainOperation;
            const oldAlert = useDialogStore.getState().showAlert;
            useAppStore.setState({ dispatchDomainOperation: dispatch });
            useDialogStore.setState({ showAlert: vi.fn(async () => {}) });
            const hook = kind === 'routine'
                ? renderHook(() => useTrainingRoutines())
                : renderHook(() => useTrainingExercises());
            try {
                const competing = kind === 'routine'
                    ? { name: 'Un’altra scheda', exercises: [] }
                    : { ...first, name: 'Un’altra scheda' };
                writeWorkoutRecoveryDraft(name, owner, competing);
                const intact = localStorage.getItem(protectedDeviceKey(name, owner));
                expect(intact).toMatch(/^tlb-sealed:v1:/);

                if (kind === 'routine') {
                    const editor = hook as ReturnType<typeof renderHook<ReturnType<typeof useTrainingRoutines>, unknown>>;
                    act(() => editor.result.current.setRoutineName('Valore obsoleto'));
                    await act(async () => { expect(await editor.result.current.handleSave()).toBe(false); });
                    expect(editor.result.current.handleCancelEdit()).toBe(false);
                } else {
                    const editor = hook as ReturnType<typeof renderHook<ReturnType<typeof useTrainingExercises>, unknown>>;
                    act(() => editor.result.current.setExName('Valore obsoleto'));
                    await act(async () => { expect(await editor.result.current.handleSaveExercise()).toBe(false); });
                    expect(editor.result.current.handleCancelEdit()).toBe(false);
                }
                expect(dispatch).not.toHaveBeenCalled();
                expect(localStorage.getItem(protectedDeviceKey(name, owner))).toBe(intact);
                expect(useAppStore.getState().localPersistenceBlocked).toBe(true);
            } finally {
                hook.unmount();
                useAppStore.setState({ dispatchDomainOperation: oldDispatch });
                useDialogStore.setState({ showAlert: oldAlert });
            }
        },
    );

    it.each(['routine', 'exercise'] as const)(
        'retains newer %s edits made while an earlier domain commit is awaiting its result',
        async kind => {
            const owner = storageOwner();
            const name = kind === 'routine' ? 'draft_routine' : 'draft_exercise';
            const originalDispatch = useAppStore.getState().dispatchDomainOperation;
            const originalAlert = useDialogStore.getState().showAlert;
            let notifyCommitted!: () => void;
            let releaseCommit!: () => void;
            const committed = new Promise<void>(resolve => { notifyCommitted = resolve; });
            const release = new Promise<void>(resolve => { releaseCommit = resolve; });
            useAppStore.setState({ dispatchDomainOperation: async operation => {
                const result = await originalDispatch(operation);
                notifyCommitted();
                await release;
                return result;
            } });
            useDialogStore.setState({ showAlert: vi.fn(async () => {}) });
            try {
                if (kind === 'routine') {
                    const hook = renderHook(() => useTrainingRoutines());
                    try {
                        act(() => hook.result.current.setRoutineName('Scheda confermata'));
                        let saving!: Promise<boolean>;
                        act(() => { saving = hook.result.current.handleSave(); });
                        await committed;
                        act(() => hook.result.current.setRoutineName('Modifica ancora aperta'));
                        const latest = readDeviceValueStrict(name, owner);
                        await act(async () => { releaseCommit(); expect(await saving).toBe(false); });
                        expect(hook.result.current.routineName).toBe('Modifica ancora aperta');
                        expect(readDeviceValueStrict(name, owner)).toBe(latest);
                        expect((await readLocal(owner))?.data.routines?.some(r => r.name === 'Scheda confermata')).toBe(true);
                    } finally { hook.unmount(); }
                } else {
                    const hook = renderHook(() => useTrainingExercises());
                    try {
                        act(() => hook.result.current.setExName('Esercizio confermato'));
                        let saving!: Promise<boolean>;
                        act(() => { saving = hook.result.current.handleSaveExercise(); });
                        await committed;
                        act(() => hook.result.current.setExNotes('Nuova nota da conservare'));
                        const latest = readDeviceValueStrict(name, owner);
                        await act(async () => { releaseCommit(); expect(await saving).toBe(false); });
                        expect(hook.result.current.exNotes).toBe('Nuova nota da conservare');
                        expect(readDeviceValueStrict(name, owner)).toBe(latest);
                        expect((await readLocal(owner))?.data.library?.some(e => e.name === 'Esercizio confermato')).toBe(true);
                    } finally { hook.unmount(); }
                }
            } finally {
                releaseCommit?.();
                useAppStore.setState({ dispatchDomainOperation: originalDispatch });
                useDialogStore.setState({ showAlert: originalAlert });
            }
        },
    );

    it('quarantines old exercise and routine drafts before hydration or mount cleanup', async () => {
        const owner = storageOwner();
        const marker = `logbook:v2:${owner}:health-consent-generation`;
        const exercise = JSON.stringify({ name: 'Deleted old exercise', notes: 'Old notes' });
        const routine = JSON.stringify({ name: 'Deleted old routine', exercises: [] });
        // An authentic sealed record with no known source revision remains
        // quarantined after a consent-epoch change, without losing its bytes.
        writeDeviceValue('draft_exercise', exercise, owner);
        writeDeviceValue('draft_routine', routine, owner);
        const exerciseCiphertext = localStorage.getItem(protectedDeviceKey('draft_exercise', owner));
        const routineCiphertext = localStorage.getItem(protectedDeviceKey('draft_routine', owner));
        localStorage.setItem(marker, '3');

        const ex = renderHook(() => useTrainingExercises());
        const rt = renderHook(() => useTrainingRoutines());
        expect(ex.result.current.exName).toBe('');
        expect(rt.result.current.routineName).toBe('');
        await waitFor(() => expect(useAppStore.getState().localPersistenceBlocked).toBe(true));
        expect(readDeviceValueStrict('draft_exercise', owner)).toBe(exercise);
        expect(readDeviceValueStrict('draft_routine', owner)).toBe(routine);
        expect(localStorage.getItem(protectedDeviceKey('draft_exercise', owner))).toBe(exerciseCiphertext);
        expect(localStorage.getItem(protectedDeviceKey('draft_routine', owner))).toBe(routineCiphertext);
        expect(localStorage.getItem(deviceKey('draft_exercise', owner))).toBeNull();
        expect(localStorage.getItem(deviceKey('draft_routine', owner))).toBeNull();
        ex.unmount();
        rt.unmount();
    });

    it('prevents an already mounted routine editor from committing old values after another tab advances consent', async () => {
        const owner = storageOwner();
        const marker = `logbook:v2:${owner}:health-consent-generation`;
        localStorage.setItem(marker, '3');
        const dispatch = vi.fn(async () => ({ ok: true as const, status: 'synced' as const }));
        const originalDispatch = useAppStore.getState().dispatchDomainOperation;
        const originalAlert = useDialogStore.getState().showAlert;
        useAppStore.setState({ dispatchDomainOperation: dispatch });
        useDialogStore.setState({ showAlert: vi.fn(async () => {}) });
        try {
            const { result, unmount } = renderHook(() => useTrainingRoutines());
            act(() => result.current.setRoutineName('Current routine'));
            const raw = readDeviceValueStrict('draft_routine', owner);
            expect(JSON.parse(raw!)).toMatchObject({
                __logbookWorkoutRecoveryDraft: 1, owner, name: 'draft_routine',
                consentRevision: 3, data: { name: 'Current routine' },
            });
            localStorage.setItem(marker, '5');
            await act(async () => {
                expect(await result.current.handleSave()).toBe(false);
            });
            expect(dispatch).not.toHaveBeenCalled();
            expect(readDeviceValueStrict('draft_routine', owner)).toBe(raw);
            expect(localStorage.getItem(deviceKey('draft_routine', owner))).toBeNull();
            expect(localStorage.getItem(protectedDeviceKey('draft_routine', owner))).toMatch(/^tlb-sealed:v1:/);
            unmount();
        } finally {
            useAppStore.setState({ dispatchDomainOperation: originalDispatch });
            useDialogStore.setState({ showAlert: originalAlert });
        }
    });

    it('prevents an already mounted exercise editor from committing old values after another tab advances consent', async () => {
        const owner = storageOwner();
        const marker = `logbook:v2:${owner}:health-consent-generation`;
        localStorage.setItem(marker, '3');
        const dispatch = vi.fn(async () => ({ ok: true as const, status: 'synced' as const }));
        const originalDispatch = useAppStore.getState().dispatchDomainOperation;
        const originalAlert = useDialogStore.getState().showAlert;
        useAppStore.setState({ dispatchDomainOperation: dispatch });
        useDialogStore.setState({ showAlert: vi.fn(async () => {}) });
        try {
            const { result, unmount } = renderHook(() => useTrainingExercises());
            act(() => result.current.setExName('Current exercise'));
            const raw = readDeviceValueStrict('draft_exercise', owner);
            expect(JSON.parse(raw!)).toMatchObject({
                __logbookWorkoutRecoveryDraft: 1, owner, name: 'draft_exercise',
                consentRevision: 3, data: { name: 'Current exercise' },
            });
            localStorage.setItem(marker, '5');
            await act(async () => {
                expect(await result.current.handleSaveExercise()).toBe(false);
            });
            expect(dispatch).not.toHaveBeenCalled();
            expect(readDeviceValueStrict('draft_exercise', owner)).toBe(raw);
            expect(localStorage.getItem(deviceKey('draft_exercise', owner))).toBeNull();
            expect(localStorage.getItem(protectedDeviceKey('draft_exercise', owner))).toMatch(/^tlb-sealed:v1:/);
            unmount();
        } finally {
            useAppStore.setState({ dispatchDomainOperation: originalDispatch });
            useDialogStore.setState({ showAlert: originalAlert });
        }
    });

});
