import React from 'react';
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { screen, fireEvent, renderHook, act, waitFor } from '@testing-library/react';
import { renderWithProviders, emptyUserData, idbStore } from '../../setup';
import { useAppStore } from '../../../src/store/useAppStore';
import { useDialogStore } from '../../../src/store/useDialogStore';
import { useTrainingExercises } from '../../../src/hooks/useTrainingExercises';
import { clearCatalogCache, getInMemoryCatalog, saveCatalogToCache } from '../../../src/lib/catalog/catalogService';
import { set as idbSet } from 'idb-keyval';
import TrainingExercises from '../../../src/components/Training/TrainingExercises';
import type { Exercise } from '../../../src/types';
import { deviceKey, protectedDeviceKey, readDeviceValueStrict } from '../../../src/lib/sync/deviceStorage';
import { readWorkoutRecoveryDraft, writeWorkoutRecoveryDraft } from '../../../src/lib/sync/workoutRecoveryDraft';
import { captureSession, invalidateSession, isCurrentSession } from '../../../src/lib/sync/session';
import { initializeLocal, readLocal } from '../../../src/lib/sync/localRepository';
import { prepareUnlockedTestArchive } from '../../secureVaultFixture';

describe('Worker M2: Exercise Library UI & Food Form Real-Time Calorie Calculation', () => {

    beforeEach(() => {
        window.localStorage.clear();
        useAppStore.getState().resetStore();
        vi.clearAllMocks();
    });

    afterEach(() => {
        window.localStorage.clear();
        useAppStore.getState().resetStore();
        vi.restoreAllMocks();
    });

    /* =========================================================================
     * 1. useTrainingExercises Hook Tests
     * ========================================================================= */
    describe('useTrainingExercises Hook', () => {
        it('initializes with isBodyweight=false and equipmentWeight=""', () => {
            const { result } = renderHook(() => useTrainingExercises());
            expect(result.current.isBodyweight).toBe(false);
            expect(result.current.equipmentWeight).toBe('');
        });

        it('restores isBodyweight and equipmentWeight from an authenticated device draft', async () => {
            const owner = captureSession().owner;
            await prepareUnlockedTestArchive(owner);
            localStorage.setItem(`logbook:v2:${owner}:health-consent-generation`, '3');
            const draft = {
                name: 'Trazioni zavorrate',
                notes: 'Cintura da sovraccarico',
                trackingType: 'weight_reps',
                selectedMuscles: [{ id: 'lats', name: 'Gran dorsale' }],
                secondaryMuscles: [{ id: 'biceps', name: 'Bicipiti' }],
                isBodyweight: true,
                equipmentWeight: '5'
            };
            writeWorkoutRecoveryDraft('draft_exercise', owner, draft);
            const sealedKey = protectedDeviceKey('draft_exercise', owner);
            const ciphertext = localStorage.getItem(sealedKey);
            expect(ciphertext).toMatch(/^tlb-sealed:v1:/);
            expect(readWorkoutRecoveryDraft('draft_exercise', owner)).toMatchObject(draft);
            expect(localStorage.getItem(deviceKey('draft_exercise', owner))).toBeNull();

            const { result } = renderHook(() => useTrainingExercises());
            expect(result.current.exName).toBe('Trazioni zavorrate');
            expect(result.current.isBodyweight).toBe(true);
            expect(result.current.equipmentWeight).toBe('5');
            expect(localStorage.getItem(deviceKey('draft_exercise', owner))).toBeNull();
            expect(localStorage.getItem(sealedKey)).toMatch(/^tlb-sealed:v1:/);
        });

        it('handleEditClick populates isBodyweight and equipmentWeight from exercise object', () => {
            const exercise: Exercise = {
                id: 'ex-bench-barbell',
                name: 'Panca piana con bilanciere',
                setsCount: 4,
                sets: [],
                trackingType: 'weight_reps',
                isBodyweight: false,
                equipmentWeight: 20
            };

            const { result } = renderHook(() => useTrainingExercises());

            act(() => {
                result.current.handleEditClick(exercise);
            });

            expect(result.current.editingExId).toBe('ex-bench-barbell');
            expect(result.current.exName).toBe('Panca piana con bilanciere');
            expect(result.current.isBodyweight).toBe(false);
            expect(result.current.equipmentWeight).toBe('20');
        });

        it('handleCancelEdit resets isBodyweight and equipmentWeight and clears the sealed draft', async () => {
            const owner = captureSession().owner;
            await prepareUnlockedTestArchive(owner);
            const exercise: Exercise = {
                id: 'ex-dips',
                name: 'Dip parallele',
                setsCount: 3,
                sets: [],
                trackingType: 'weight_reps',
                isBodyweight: true,
                equipmentWeight: 2.5
            };

            const { result } = renderHook(() => useTrainingExercises());

            act(() => {
                result.current.handleEditClick(exercise);
            });
            expect(result.current.isBodyweight).toBe(true);
            expect(result.current.equipmentWeight).toBe('2.5');

            act(() => {
                result.current.handleCancelEdit();
            });
            expect(result.current.editingExId).toBeNull();
            expect(result.current.isBodyweight).toBe(false);
            expect(result.current.equipmentWeight).toBe('');
            expect(window.localStorage.getItem(protectedDeviceKey('draft_exercise', owner))).toBeNull();
            expect(readDeviceValueStrict('draft_exercise', owner)).toBeNull();
            expect(window.localStorage.getItem(deviceKey('draft_exercise', owner))).toBeNull();
        });

        it('does not discard unsaved exercise fields if the protected draft cannot be cleared', async () => {
            const owner = captureSession().owner;
            await prepareUnlockedTestArchive(owner);
            if (owner.startsWith('user:')) {
                localStorage.setItem(`logbook:v2:${owner}:health-consent-generation`, '3');
            }
            const { result } = renderHook(() => useTrainingExercises());
            act(() => result.current.setExName('Modifica da preservare'));
            const sealedKey = protectedDeviceKey('draft_exercise', owner);
            const original = window.localStorage.getItem(sealedKey);
            expect(original).toMatch(/^tlb-sealed:v1:/);

            const originalRemove = vi.mocked(window.localStorage.removeItem).getMockImplementation();
            if (!originalRemove) throw new Error('Storage mock non inizializzato.');
            vi.mocked(window.localStorage.removeItem).mockImplementation((key) => {
                if (key === sealedKey) throw new Error('quota');
                originalRemove(key);
            });
            try {
                let cancelled!: boolean;
                act(() => { cancelled = result.current.handleCancelEdit(); });
                expect(cancelled).toBe(false);
                expect(result.current.exName).toBe('Modifica da preservare');
                expect(window.localStorage.getItem(sealedKey)).toBe(original);
                expect(useAppStore.getState().localPersistenceBlocked).toBe(true);
            } finally {
                vi.mocked(window.localStorage.removeItem).mockImplementation(originalRemove);
            }
        });

        it('does not quarantine current storage or discard a previous Auth epoch\'s exercise draft', async () => {
            const owner = captureSession().owner;
            await prepareUnlockedTestArchive(owner);
            if (owner.startsWith('user:')) {
                localStorage.setItem(`logbook:v2:${owner}:health-consent-generation`, '3');
            }
            const { result } = renderHook(() => useTrainingExercises());
            act(() => result.current.setExName('Esercizio della sessione precedente'));
            const sealedKey = protectedDeviceKey('draft_exercise', owner);
            const original = localStorage.getItem(sealedKey);
            expect(original).toMatch(/^tlb-sealed:v1:/);

            invalidateSession();
            let cancelled!: boolean;
            act(() => { cancelled = result.current.handleCancelEdit(); });
            expect(cancelled).toBe(false);
            expect(result.current.exName).toBe('Esercizio della sessione precedente');
            expect(localStorage.getItem(sealedKey)).toBe(original);
            expect(useAppStore.getState().localPersistenceBlocked).toBe(false);
        });

        it('handleSaveExercise creates new exercise with isBodyweight and equipmentWeight', async () => {
            const owner = captureSession().owner;
            localStorage.setItem(`logbook:v2:${owner}:health-consent-generation`, '3');
            const initialData = {
                    ...emptyUserData,
                    library: []
                };
            await prepareUnlockedTestArchive(owner);
            await initializeLocal(owner, initialData);
            useAppStore.setState({ dataOwner: owner, userData: initialData });

            const { result } = renderHook(() => useTrainingExercises());

            act(() => {
                result.current.setExName('Pull-up corpo libero');
                result.current.setIsBodyweight(true);
                result.current.setEquipmentWeight('2,5');
            });

            await act(async () => {
                await result.current.handleSaveExercise();
            });

            const updatedLib = useAppStore.getState().userData?.library || [];
            expect(updatedLib.length).toBe(1);
            expect(updatedLib[0].name).toBe('Pull-up corpo libero');
            expect(updatedLib[0].isBodyweight).toBe(true);
            expect(updatedLib[0].equipmentWeight).toBe(2.5);
            expect((await readLocal(owner))?.data.library?.[0]?.equipmentWeight).toBe(2.5);
            expect(idbStore['logbook:v2:' + owner]).toMatch(/^tlb-sealed:v1:/);
        });

        it('handleSaveExercise updates existing exercise and preserves isBodyweight & equipmentWeight', async () => {
            const existingEx: Exercise = {
                id: 'ex-squat',
                name: 'Squat',
                setsCount: 4,
                sets: [],
                trackingType: 'weight_reps'
            };

            const owner = captureSession().owner;
            const initialData = {
                    ...emptyUserData,
                    library: [existingEx]
                };
            await prepareUnlockedTestArchive(owner);
            await initializeLocal(owner, initialData);
            useAppStore.setState({ dataOwner: owner, userData: initialData });

            const { result } = renderHook(() => useTrainingExercises());

            act(() => {
                result.current.handleEditClick(existingEx);
            });

            act(() => {
                result.current.setIsBodyweight(false);
                result.current.setEquipmentWeight('20');
            });

            await act(async () => {
                await result.current.handleSaveExercise();
            });

            const updatedLib = useAppStore.getState().userData?.library || [];
            expect(updatedLib.length).toBe(1);
            expect(updatedLib[0].id).toBe('ex-squat');
            expect(updatedLib[0].equipmentWeight).toBe(20);
            expect((await readLocal(owner))?.data.library?.[0]?.equipmentWeight).toBe(20);
            expect(idbStore['logbook:v2:' + owner]).toMatch(/^tlb-sealed:v1:/);
        });



        it('confirms a created exercise in the encrypted owner archive after the domain commit', async () => {
            const owner = captureSession().owner;
            localStorage.setItem(`logbook:v2:${owner}:health-consent-generation`, '3');
            const initialData = { ...emptyUserData, library: [] };
            await prepareUnlockedTestArchive(owner);
            await initializeLocal(owner, initialData);
            useAppStore.setState({ userData: initialData, dataOwner: owner });
            const { result } = renderHook(() => useTrainingExercises());
            act(() => result.current.setExName('Rematore personale'));
            let success = false;
            await act(async () => {
                const pending = result.current.handleSaveExercise();
                await useAppStore.getState().flushPendingSyncs();
                success = await pending;
            });
            expect(success).toBe(true);
            const stored = await readLocal(owner);
            expect(stored?.data.library?.find(ex => ex.name === 'Rematore personale')).toMatchObject({
                name: 'Rematore personale', setsCount: 3,
            });
        });

        it('notifies the current session when an exercise duplicate cannot be persisted', async () => {
            const original: Exercise = {
                id: 'ex-original', name: 'Panca inclinata', setsCount: 3, sets: [],
                trackingType: 'weight_reps', isDefault: true,
            };
            const owner = captureSession().owner;
            const initialData = { ...emptyUserData, library: [original] };
            await prepareUnlockedTestArchive(owner);
            await initializeLocal(owner, initialData);
            useAppStore.setState({ dataOwner: owner, userData: initialData });

            const originalDispatch = useAppStore.getState().dispatchDomainOperation;
            const failedDispatch = vi.fn().mockResolvedValue({
                ok: false, status: 'failed', error: new Error('Disk unavailable'),
            });
            useAppStore.setState({ dispatchDomainOperation: failedDispatch });
            const alert = vi.spyOn(useDialogStore.getState(), 'showAlert').mockResolvedValue(undefined);
            const log = vi.spyOn(console, 'error').mockImplementation(() => {});
            try {
                const { result } = renderHook(() => useTrainingExercises());
                await act(async () => { await result.current.handleDuplicate(original); });
                expect(failedDispatch).toHaveBeenCalledOnce();
                expect(alert).toHaveBeenCalledWith("Errore durante la duplicazione dell'esercizio.");
                expect(useAppStore.getState().userData?.library).toHaveLength(1);
            } finally {
                useAppStore.setState({ dispatchDomainOperation: originalDispatch });
                alert.mockRestore();
                log.mockRestore();
            }
        });

        it('handleDuplicate creates a unique personal exercise through Domain Operations', async () => {
            const original: Exercise = {
                id: 'ex-original',
                name: 'Panca inclinata',
                setsCount: 3,
                sets: [],
                trackingType: 'weight_reps',
                isDefault: true
            };

            const owner = captureSession().owner;
            const initialData = {
                    ...emptyUserData,
                    library: [original]
                };
            await prepareUnlockedTestArchive(owner);
            await initializeLocal(owner, initialData);
            useAppStore.setState({ dataOwner: owner, userData: initialData });

            const { result } = renderHook(() => useTrainingExercises());

            await act(async () => {
                await result.current.handleDuplicate(original);
            });

            const updatedLib = useAppStore.getState().userData?.library || [];
            expect(updatedLib).toHaveLength(2);
            const duplicate = updatedLib.find(ex => ex.id !== original.id);
            expect(duplicate).toBeDefined();
            expect(duplicate?.name).not.toBe(original.name);
            expect(duplicate?.isDefault).toBe(false);
            expect((await readLocal(owner))?.data.library?.some(ex => ex.id === duplicate?.id)).toBe(true);
            expect(idbStore['logbook:v2:' + owner]).toMatch(/^tlb-sealed:v1:/);
        });

        it.each(['delete', 'restore'] as const)(
            'refuses stale %s confirmation even when the next Auth epoch reuses the exercise ID', async action => {
                const owner = captureSession().owner;
                const sameId = 'shared-exercise';
                const original: Exercise = {
                    id: sameId, name: 'Esercizio A', trackingType: 'weight_reps',
                    setsCount: 3, sets: [], isDefault: action === 'restore',
                };
                if (action === 'restore') {
                    await clearCatalogCache();
                    await saveCatalogToCache({
                        manifest: {
                            version: 'stale-auth-test', updatedAt: '2026-10-20T00:00:00.000Z',
                            schemaVersion: 1, docRefs: { exercises: 'ex-test', foods: 'food-test' },
                            itemCounts: { exercises: 1, foods: 0 },
                        },
                        exercises: [original as any], foods: [], cachedAt: Date.now(),
                    });
                }
                const previousDispatch = useAppStore.getState().dispatchDomainOperation;
                const showConfirm = vi.mocked(useDialogStore.getState().showConfirm);
                let confirm!: (choice: boolean) => void;
                // The suite's dialog fixture has an inert setState; configure its callable mock.
                showConfirm.mockReset().mockImplementationOnce(() => new Promise<boolean>(resolve => { confirm = resolve; }));
                const dispatch = vi.fn().mockResolvedValue({ ok: true, status: 'synced' });
                const initialData = { ...emptyUserData, library: [original] };
                // This is a real owner-bound editor: its protected draft must be readable
                // before testing the subsequent Auth-epoch transition.
                await prepareUnlockedTestArchive(owner);
                await initializeLocal(owner, initialData);
                useAppStore.setState({
                    dataOwner: owner,
                    userData: initialData,
                    dispatchDomainOperation: dispatch,
                });
                try {
                    const sessionBeforeMount = captureSession();
                    expect(isCurrentSession(sessionBeforeMount)).toBe(true);
                    expect(useDialogStore.getState().showConfirm).toBe(showConfirm);
                    const { result } = renderHook(() => useTrainingExercises());
                    expect(isCurrentSession(sessionBeforeMount)).toBe(true);
                    expect(useDialogStore.getState().showConfirm).toBe(showConfirm);
                    expect(useAppStore.getState().dataOwner).toBe(owner);
                    expect(useAppStore.getState().localPersistenceBlocked).toBe(false);
                    let pending!: Promise<unknown>;
                    act(() => {
                        pending = action === 'delete'
                            ? result.current.handleDelete(sameId, { stopPropagation: vi.fn() })
                            : result.current.handleRestoreExercise(sameId);
                    });
                    // Restore now verifies the durable catalog before presenting confirmation.
                    await waitFor(() => expect(showConfirm).toHaveBeenCalledOnce());
                    act(() => { invalidateSession(); invalidateSession(); });
                    await act(async () => { confirm(true); await pending; });
                    expect(dispatch).not.toHaveBeenCalled();
                } finally {
                    useAppStore.setState({ dispatchDomainOperation: previousDispatch });
                    showConfirm.mockReset().mockResolvedValue(true);
                    if (action === 'restore') await clearCatalogCache();
                }
            },
        );

        it('handleDelete blocks catalog exercises and deletes personal exercises after confirmation', async () => {
            const catalogExercise: Exercise = {
                id: 'ex-catalog',
                name: 'Catalogo',
                setsCount: 3,
                sets: [],
                trackingType: 'weight_reps',
                isDefault: true
            };
            const customExercise: Exercise = {
                id: 'ex-custom',
                name: 'Personale',
                setsCount: 3,
                sets: [],
                trackingType: 'weight_reps',
                isDefault: false
            };
            const showAlert = vi.fn().mockResolvedValue(undefined);
            const showConfirm = vi.fn().mockResolvedValue(true);
            useDialogStore.setState({ showAlert, showConfirm });
            const owner = captureSession().owner;
            const initialData = {
                    ...emptyUserData,
                    library: [catalogExercise, customExercise],
                    routines: [
                        {
                            id: 'routine-a',
                            name: 'Scheda A',
                            exercises: [
                                { exId: customExercise.id, setsCount: 3 },
                                { exId: catalogExercise.id, setsCount: 3 }
                            ]
                        },
                        {
                            id: 'routine-b',
                            name: 'Scheda B',
                            exercises: [{ exId: customExercise.id, setsCount: 4 }]
                        }
                    ]
                };
            await prepareUnlockedTestArchive(owner);
            await initializeLocal(owner, initialData);
            useAppStore.setState({ dataOwner: owner, userData: initialData });

            const { result } = renderHook(() => useTrainingExercises());
            const stopPropagation = vi.fn();

            let catalogDeleted = true;
            await act(async () => {
                catalogDeleted = await result.current.handleDelete(catalogExercise.id, { stopPropagation });
            });
            expect(catalogDeleted).toBe(false);
            expect(useAppStore.getState().userData?.library).toHaveLength(2);

            let customDeleted = false;
            await act(async () => {
                customDeleted = await result.current.handleDelete(customExercise.id, { stopPropagation });
            });
            expect(customDeleted).toBe(true);
            expect(useAppStore.getState().userData?.library?.map(ex => ex.id)).toEqual([catalogExercise.id]);
            expect(
                useAppStore.getState().userData?.routines?.map(routine => routine.exercises.map(exercise => exercise.exId))
            ).toEqual([[catalogExercise.id], []]);
            expect((await readLocal(owner))?.data.library?.map(ex => ex.id)).toEqual([catalogExercise.id]);
            expect(idbStore['logbook:v2:' + owner]).toMatch(/^tlb-sealed:v1:/);
        });

        it('handleRestoreExercise retrieves the durable catalog despite a stale empty in-memory seed', async () => {
            await clearCatalogCache();
            const original: Exercise = {
                id: 'catalog-restore',
                name: 'Panca catalogo',
                notes: 'Setup originale',
                muscles: ['chest_upper'],
                secondaryMuscles: ['triceps'],
                setsCount: 3,
                sets: [],
                trackingType: 'weight_reps',
                isDefault: true
            };
            await idbSet('logbook_cached_global_catalog', {
                manifest: {
                    version: 'test-restore',
                    updatedAt: '2026-09-28T00:00:00.000Z',
                    schemaVersion: 1,
                    docRefs: { exercises: 'exercises_test', foods: 'foods_test' },
                    itemCounts: { exercises: 1, foods: 0 }
                },
                exercises: [original],
                foods: [],
                cachedAt: Date.now()
            });
            expect(getInMemoryCatalog().exercises).toEqual([]);

            const modified: Exercise = {
                ...original,
                name: `${original.name} modificato`,
                notes: 'Override locale',
                isDefault: true
            };
            const showConfirm = vi.fn().mockResolvedValue(true);
            useDialogStore.setState({
                showConfirm,
                showAlert: vi.fn().mockResolvedValue(undefined)
            });
            const owner = captureSession().owner;
            const initialData = {
                    ...emptyUserData,
                    library: [modified]
                };
            await prepareUnlockedTestArchive(owner);
            await initializeLocal(owner, initialData);
            useAppStore.setState({ dataOwner: owner, userData: initialData });

            const { result } = renderHook(() => useTrainingExercises());

            await act(async () => {
                await result.current.handleRestoreExercise(String(original.id));
            });

            const restored = useAppStore.getState().userData?.library?.find(ex => String(ex.id) === String(original.id));
            expect(restored?.name).toBe(original.name);
            expect(restored?.notes).toBe(original.notes);
            expect(restored?.trackingType).toBe(original.trackingType);
            expect(restored?.muscles).toEqual(original.muscles);
            expect(restored?.secondaryMuscles).toEqual(original.secondaryMuscles);
            expect(restored?.sets).toEqual([]);
            expect((await readLocal(owner))?.data.library?.find(ex => ex.id === original.id)?.notes).toBe(original.notes);
            expect(idbStore['logbook:v2:' + owner]).toMatch(/^tlb-sealed:v1:/);

            await clearCatalogCache();
        });
    });

    /* =========================================================================
     * 2. TrainingExercises Component UI Tests
     * ========================================================================= */
    describe('TrainingExercises Component UI', () => {
        it('renders isBodyweight checkbox and equipmentWeight input when trackingType is weight_reps', () => {
            renderWithProviders(<TrainingExercises />, { userData: emptyUserData });

            const createBtn = screen.getByRole('button', { name: /Crea esercizio/i });
            fireEvent.click(createBtn);

            const bwCheckbox = screen.getByLabelText(/Esercizio a corpo libero/i) as HTMLInputElement;
            expect(bwCheckbox).toBeDefined();
            expect(bwCheckbox.type).toBe('checkbox');
            expect(bwCheckbox.checked).toBe(false);

            const eqInput = screen.getByPlaceholderText('0') as HTMLInputElement;
            expect(eqInput).toBeDefined();
            expect(eqInput.type).toBe('number');
        });

        it('renders the compact proposal-5 exercise list without legacy badges', () => {
            const initialLibrary: Exercise[] = [
                {
                    id: 'ex-1',
                    name: 'Trazioni alla sbarra',
                    setsCount: 4,
                    sets: [],
                    trackingType: 'weight_reps',
                    isBodyweight: true
                },
                {
                    id: 'ex-2',
                    name: 'Panca piana bilanciere',
                    setsCount: 4,
                    sets: [],
                    trackingType: 'weight_reps',
                    equipmentWeight: 20
                }
            ];

            renderWithProviders(<TrainingExercises />, {
                userData: {
                    ...emptyUserData,
                    library: initialLibrary
                }
            });

            expect(screen.getByRole('heading', { name: 'La tua libreria' })).toBeDefined();
            expect(screen.getByRole('button', { name: 'Apri dettaglio di Trazioni alla sbarra' })).toBeDefined();
            expect(screen.queryByText('Corpo libero')).toBeNull();
            expect(screen.queryByText('Attrezzo: 20 kg')).toBeNull();
        });

        it('opens the dedicated detail page with real exercise metadata', () => {
            const initialLibrary: Exercise[] = [
                {
                    id: 'ex-dips',
                    name: 'Dip alle parallele zavorrate',
                    setsCount: 3,
                    sets: [],
                    trackingType: 'weight_reps',
                    muscles: ['chest'],
                    secondaryMuscles: ['triceps'],
                    notes: 'Scapole stabili',
                    isDefault: false,
                    isBodyweight: true,
                    equipmentWeight: 5
                }
            ];

            const { container } = renderWithProviders(<TrainingExercises />, {
                userData: {
                    ...emptyUserData,
                    library: initialLibrary
                }
            });

            fireEvent.click(screen.getByRole('button', { name: 'Apri dettaglio di Dip alle parallele zavorrate' }));

            expect(screen.getByRole('region', { name: 'Dettaglio esercizio' })).toBeDefined();
            expect(screen.getByText('Peso e ripetizioni')).toBeDefined();
            expect(screen.getByText('Personale')).toBeDefined();
            expect(screen.getByText('Scapole stabili')).toBeDefined();
            expect(screen.getByRole('button', { name: 'Torna all’elenco' })).toBeDefined();
            expect(container.querySelector('.muscle-map-container')).not.toBeNull();
        });
    });

});
