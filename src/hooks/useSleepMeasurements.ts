import { dispatchDurableOperation } from '../lib/sync/dispatchDurableOperation';
import { useState, useRef } from 'react';
import { useDatedDraft } from './useDatedDraft';
import { useLocalToday } from './useLocalToday';
import { captureSession, isCurrentSession } from '../lib/sync/session';
import { useAppStore } from '../store/useAppStore';
import { useDialogStore } from '../store/useDialogStore';
import { prepareSleepPatch, sleepDraftFromDay } from '../lib/sleepForm';
import type { NutritionDay } from '../types';

const EMPTY_NUTRITION: Record<string, NutritionDay> = {};

export function useSleepMeasurements() {
    const nutrition = useAppStore(state => state.userData?.nutrition || EMPTY_NUTRITION);
    const dispatchDomainOperation = useAppStore(state => state.dispatchDomainOperation);
    const showAlert = useDialogStore(state => state.showAlert);

    const todayDateStr = useLocalToday();
    const [editingDate, setEditingDate] = useState<string | null>(null);
    const [chosenDate, setChosenDate] = useState<string | null>(null);
    const selectedDate = chosenDate ?? todayDateStr;
    const setSelectedDate = (date: string) => { setEditingDate(null); setChosenDate(date === todayDateStr ? null : date); };
    const targetDate = editingDate || selectedDate;
    const day = nutrition[targetDate];
    const draft = useDatedDraft('sleep', targetDate, sleepDraftFromDay(day));
    const { sleepHours, sleepDeep, sleepLight, sleepRem, sleepAwake } = draft.values;
    const saving = useRef(false);
    const cancelEdit = (): boolean => {
        try {
            if (!draft.clear()) return false;
            setEditingDate(null);
            return true;
        } catch {
            return false;
        }
    };
    const saveSleep = async (e?: { preventDefault(): void }) => {
        if (e) e.preventDefault();
        if (saving.current) return false;
        saving.current = true;
        const session = captureSession();
        const submitted = { ...draft.values };
        try {
            const prepared = prepareSleepPatch(draft.values);
            if (!prepared.ok) {
                await showAlert(prepared.message);
                return;
            }
            const targetDate = editingDate || selectedDate;

            if (!isCurrentSession(session)) throw new Error('Sessione cambiata');
            draft.verifyCurrentDraft();
            await dispatchDurableOperation(dispatchDomainOperation, {
                type: 'nutrition-day.patch',
                date: targetDate,
                patch: prepared.patch,
            });
            if (!isCurrentSession(session)) return false;
            const cleared = draft.clear(submitted);
            if (cleared && isCurrentSession(session)) setEditingDate(null);
            return cleared;
        } catch {
            if (isCurrentSession(session)) await showAlert("Errore durante il salvataggio dei dati del sonno.");
            return false;
        } finally { saving.current = false; }
    };

    return {
        editingDate,
        setEditingDate,
        cancelEdit,
        selectedDate: targetDate,
        setSelectedDate,
        sleepHours, setSleepHours: (value: string) => draft.setField('sleepHours', value),
        sleepDeep, setSleepDeep: (value: string) => draft.setField('sleepDeep', value),
        sleepLight, setSleepLight: (value: string) => draft.setField('sleepLight', value),
        sleepRem, setSleepRem: (value: string) => draft.setField('sleepRem', value),
        sleepAwake, setSleepAwake: (value: string) => draft.setField('sleepAwake', value),
        saveSleep
    };
}
