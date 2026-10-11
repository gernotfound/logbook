import React from 'react';
import { act, fireEvent, render, renderHook, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { UserDataSchema } from '../src/lib/schema';
import { storageOwner } from '../src/lib/sync/session';
import { deviceKey } from '../src/lib/sync/deviceStorage';
import { useAppStore } from '../src/store/useAppStore';
import { useDialogStore } from '../src/store/useDialogStore';
import { useNutritionMeasurements } from '../src/hooks/useNutritionMeasurements';
import { useSleepMeasurements } from '../src/hooks/useSleepMeasurements';
import { useActivityTracking } from '../src/hooks/useActivityTracking';
import { useTrainingRoutines } from '../src/hooks/useTrainingRoutines';
import TrainingPlanning from '../src/components/Training/planning/TrainingPlanning';

const DAY = '2026-09-24';

describe('failed domain result preserves user edits', () => {
    let originalDispatch: ReturnType<typeof useAppStore.getState>['dispatchDomainOperation'];
    beforeEach(() => {
        localStorage.clear();
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
        const key = deviceKey('draft:measurement:' + DAY, storageOwner());
        expect(localStorage.getItem(key)).toContain('75');
        let saved: unknown;
        await act(async () => { saved = await hook.result.current.calculateAndSave(); });
        expect(saved).toBe(false);
        expect(hook.result.current.weight).toBe('75');
        expect(localStorage.getItem(key)).toContain('75');
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
});
