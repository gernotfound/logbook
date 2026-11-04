import React from 'react';
import { act, fireEvent, render, renderHook, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { UserDataSchema } from '../src/lib/schema';
import { storageOwner } from '../src/lib/sync/session';
import { protectedDeviceKey, readDeviceValueStrict } from '../src/lib/sync/deviceStorage';
import { prepareUnlockedTestArchive } from './secureVaultFixture';
import { useAppStore } from '../src/store/useAppStore';
import { useDialogStore } from '../src/store/useDialogStore';
import { useNutritionMeasurements } from '../src/hooks/useNutritionMeasurements';
import { useSleepMeasurements } from '../src/hooks/useSleepMeasurements';
import { useActivityTracking } from '../src/hooks/useActivityTracking';
import { cardioDraftKind } from '../src/lib/activity';
import { useTrainingRoutines } from '../src/hooks/useTrainingRoutines';
import TrainingPlanning from '../src/components/Training/planning/TrainingPlanning';

const DAY = '2026-09-24';

describe('failed domain result preserves user edits', () => {
    let originalDispatch: ReturnType<typeof useAppStore.getState>['dispatchDomainOperation'];
    beforeEach(async () => {
        localStorage.clear();
        localStorage.setItem(`logbook:v2:${storageOwner()}:health-consent-generation`, '1');
        await prepareUnlockedTestArchive(storageOwner());
        vi.clearAllMocks();
        originalDispatch = useAppStore.getState().dispatchDomainOperation;
        useAppStore.setState({
            userData: UserDataSchema.parse({
                profile: { height: '180', gender: 'M' },
                routines: [{ id: 'routine-1', name: 'Scheda A', exercises: [] }],
                trainingCycles: [
                    { id: 'cycle-1', name: 'Ciclo A', durationWeeks: 4, routines: [{ routineId: 'routine-1', frequencyPerWeek: 1 }] },
                    { id: 'cycle-2', name: 'Ciclo B', durationWeeks: 4, routines: [{ routineId: 'routine-1', frequencyPerWeek: 1 }] },
                ],
            }) as any,
            dataOwner: storageOwner(),
            localPersistenceBlocked: false,
            compatibilityStatus: 'ok',
            saveError: null,
        });
        useAppStore.setState({
            dispatchDomainOperation: vi.fn().mockResolvedValue({
                ok: false, status: 'failed', error: new Error('Aggiornamento richiesto'),
            }),
        });
    });

    afterEach(() => {
        useAppStore.setState({ dispatchDomainOperation: originalDispatch });
        vi.restoreAllMocks();
    });

    it('keeps a measurement draft when the dispatcher resolves to failure', async () => {
        const hook = renderHook(() => useNutritionMeasurements(DAY));
        act(() => hook.result.current.setWeight('75'));
        const key = protectedDeviceKey('draft:measurement:' + DAY, storageOwner());
        expect(localStorage.getItem(key)).toMatch(/^tlb-sealed:v1:/);
        expect(readDeviceValueStrict('draft:measurement:' + DAY, storageOwner())).toContain('75');
        let saved: unknown;
        await act(async () => { saved = await hook.result.current.calculateAndSave(); });
        expect(saved).toBe(false);
        expect(hook.result.current.weight).toBe('75');
        expect(readDeviceValueStrict('draft:measurement:' + DAY, storageOwner())).toContain('75');
        expect(localStorage.getItem(key)).toMatch(/^tlb-sealed:v1:/);
        expect(useDialogStore.getState().showAlert).toHaveBeenCalled();
    });

    it('keeps sleep and activity drafts on a non-throwing failure', async () => {
        const sleep = renderHook(() => useSleepMeasurements());
        act(() => sleep.result.current.setSleepHours('07:30'));
        let sleepSaved: unknown;
        await act(async () => { sleepSaved = await sleep.result.current.saveSleep(); });
        expect(sleepSaved).toBe(false);
        expect(sleep.result.current.sleepHours).toBe('07:30');

        const activity = renderHook(() => useActivityTracking());
        act(() => activity.result.current.setSteps('7900'));
        let stepsSaved: unknown;
        await act(async () => { stepsSaved = await activity.result.current.saveSteps(); });
        expect(stepsSaved).toBe(false);
        expect(activity.result.current.steps).toBe('7900');
    });

    it('retains routine input rather than clearing the form on a rejected result', async () => {
        const hook = renderHook(() => useTrainingRoutines());
        act(() => hook.result.current.setRoutineName('Bozza importante'));
        let saved: unknown;
        await act(async () => { saved = await hook.result.current.handleSave(); });
        expect(saved).toBe(false);
        expect(hook.result.current.routineName).toBe('Bozza importante');
    });

    it('does not replace another cycle editor until the user authorizes discarding edits', async () => {
        vi.spyOn(window, 'scrollTo').mockImplementation(() => {});
        const dialog = vi.mocked(useDialogStore.getState().showConfirm);
        dialog.mockResolvedValueOnce(false).mockResolvedValueOnce(true);
        const { container } = render(<TrainingPlanning />);
        const cards = Array.from(container.querySelectorAll('.planning-cycle-item'));
        expect(cards).toHaveLength(2);

        const editCard = (card: Element) => {
            const toggle = card.querySelector('button.planning-cycle-toggle')!;
            if (toggle.getAttribute('aria-expanded') !== 'true') fireEvent.click(toggle);
            fireEvent.click(card.querySelector('.planning-cycle-actions button')!);
        };
        editCard(cards[0]);
        const name = screen.getByLabelText('Nome ciclo') as HTMLInputElement;
        expect(name.value).toBe('Ciclo A');
        fireEvent.change(name, { target: { value: 'Ciclo A - non salvato' } });

        await act(async () => { editCard(cards[1]); });
        expect(dialog).toHaveBeenCalledTimes(1);
        expect((screen.getByLabelText('Nome ciclo') as HTMLInputElement).value).toBe('Ciclo A - non salvato');

        await act(async () => { editCard(cards[1]); });
        expect(dialog).toHaveBeenCalledTimes(2);
        expect((screen.getByLabelText('Nome ciclo') as HTMLInputElement).value).toBe('Ciclo B');
    });
    it('cancels sleep and cardio edits only after the device draft is cleared', async () => {
        const sleep = renderHook(() => useSleepMeasurements());
        act(() => sleep.result.current.setEditingDate(DAY));
        act(() => sleep.result.current.setSleepHours('07:30'));
        const owner = storageOwner();
        const sleepKey = protectedDeviceKey('draft:sleep:' + DAY, owner);
        const beforeSleep = localStorage.getItem(sleepKey);
        expect(beforeSleep).toMatch(/^tlb-sealed:v1:/);
        const originalSetItem = vi.mocked(localStorage.setItem).getMockImplementation()!;
        vi.mocked(localStorage.setItem).mockImplementation((key, value) => {
            if (key === sleepKey) throw new Error('quota');
            originalSetItem(key, value);
        });
        act(() => { expect(sleep.result.current.cancelEdit()).toBe(false); });
        expect(sleep.result.current.editingDate).toBe(DAY);
        expect(localStorage.getItem(sleepKey)).toBe(beforeSleep);
        vi.mocked(localStorage.setItem).mockImplementation(originalSetItem);
        act(() => { expect(sleep.result.current.cancelEdit()).toBe(true); });
        expect(sleep.result.current.editingDate).toBeNull();
        expect(readDeviceValueStrict('draft:sleep:' + DAY, owner)).toContain('"values":null');

    });

    it('retains the cardio editor after a failed durable draft clear, and closes it after retry', () => {
        const owner = storageOwner();
        const activity = renderHook(() => useActivityTracking());
        act(() => activity.result.current.setSelectedDate(DAY));
        act(() => activity.result.current.startNewCardio());
        act(() => activity.result.current.setCardioField('modality', 'bike'));
        const name = 'draft:' + cardioDraftKind('/new', true) + ':' + DAY;
        const cardioKey = protectedDeviceKey(name, owner);
        const before = localStorage.getItem(cardioKey);
        expect(before).toMatch(/^tlb-sealed:v1:/);

        const originalSetItem = vi.mocked(localStorage.setItem).getMockImplementation()!;
        vi.mocked(localStorage.setItem).mockImplementation((key, value) => {
            if (key === cardioKey) throw new Error('quota');
            originalSetItem(key, value);
        });
        act(() => { expect(activity.result.current.cancelCardio()).toBe(false); });
        expect(activity.result.current.editingCardioId).toBe('/new');
        expect(localStorage.getItem(cardioKey)).toBe(before);

        vi.mocked(localStorage.setItem).mockImplementation(originalSetItem);
        act(() => { expect(activity.result.current.cancelCardio()).toBe(true); });
        expect(activity.result.current.editingCardioId).toBeNull();
        expect(readDeviceValueStrict(name, owner)).toContain('"values":null');
    });

    it('persists edits to an existing cardio record with a generated underscore ID', () => {
        const id = 'cardio_12345678-1234-1234-1234-123456789abc';
        const owner = storageOwner();
        useAppStore.setState({
            userData: UserDataSchema.parse({
                nutrition: {
                    [DAY]: {
                        date: DAY,
                        cardioSessions: [{
                            id, modality: 'bike', durationMinutes: 30,
                            intensity: 'moderate', source: 'manual',
                        }],
                    },
                },
            }) as any,
            dataOwner: owner,
        });
        const activity = renderHook(() => useActivityTracking());
        act(() => activity.result.current.setSelectedDate(DAY));
        act(() => activity.result.current.editCardio(id));
        act(() => activity.result.current.setCardioField('notes', 'Nuove note cardio'));
        const name = 'draft:' + cardioDraftKind(id, false) + ':' + DAY;
        expect(readDeviceValueStrict(name, owner)).toContain('Nuove note cardio');
        expect(localStorage.getItem(protectedDeviceKey(name, owner))).toMatch(/^tlb-sealed:v1:/);
        act(() => { expect(activity.result.current.cancelCardio()).toBe(true); });
        expect(readDeviceValueStrict(name, owner)).toContain('"values":null');
    });

});
