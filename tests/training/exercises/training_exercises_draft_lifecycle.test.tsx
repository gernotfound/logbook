import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useAppStore } from '../../../src/store/useAppStore';
import { useTrainingExercises } from '../../../src/hooks/useTrainingExercises';
import type { Exercise } from '../../../src/types';
import { deviceKey, protectedDeviceKey, readDeviceValueStrict } from '../../../src/lib/sync/deviceStorage';
import { readWorkoutRecoveryDraft, writeWorkoutRecoveryDraft } from '../../../src/lib/sync/workoutRecoveryDraft';
import { captureSession, invalidateSession } from '../../../src/lib/sync/session';
import { prepareUnlockedTestArchive } from '../../secureVaultFixture';

describe('Exercise library draft identity and encrypted recovery', () => {
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

});
