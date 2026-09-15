import { useState, useRef } from 'react';
import { useDatedDraft } from './useDatedDraft';
import { useLocalToday } from './useLocalToday';
import { captureSession, isCurrentSession } from '../lib/sync/session';
import { useAppStore } from '../store/useAppStore';
import { useDialogStore } from '../store/useDialogStore';
import { Logic } from '../lib/logic';

const EMPTY_NUTRITION = {};

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
    const day = (nutrition as any)[targetDate];
    const draft = useDatedDraft('sleep', targetDate, {
        sleepHours: Logic.formatSleepTime(day?.sleepHours), sleepDeep: Logic.formatSleepTime(day?.sleepDeep),
        sleepLight: Logic.formatSleepTime(day?.sleepLight), sleepRem: Logic.formatSleepTime(day?.sleepRem), sleepAwake: Logic.formatSleepTime(day?.sleepAwake)
    });
    const { sleepHours, sleepDeep, sleepLight, sleepRem, sleepAwake } = draft.values;
    const saving = useRef(false);
    const saveSleep = async (e?: any) => {
        if (e) e.preventDefault();
        if (saving.current) return false;
        saving.current = true;
        const session = captureSession();
        const submitted = { ...draft.values };
        try {
            if (!sleepHours || !Logic.isSleepTimeValid(sleepHours)) {
                await showAlert("Le ore di sonno sono obbligatorie e devono essere in un formato valido (HH:MM).");
                return;
            }

            const parsedHours = Logic.parseSleepInput(sleepHours);
            if (!parsedHours) {
                await showAlert("Le ore di sonno sono obbligatorie e devono essere in un formato valido (HH:MM).");
                return;
            }

            if (sleepDeep && !Logic.isSleepTimeValid(sleepDeep)) {
                await showAlert("Il formato del sonno profondo non è valido (HH:MM).");
                return;
            }
            if (sleepLight && !Logic.isSleepTimeValid(sleepLight)) {
                await showAlert("Il formato del sonno leggero non è valido (HH:MM).");
                return;
            }
            if (sleepRem && !Logic.isSleepTimeValid(sleepRem)) {
                await showAlert("Il formato del sonno REM non è valido (HH:MM).");
                return;
            }
            if (sleepAwake && !Logic.isSleepTimeValid(sleepAwake)) {
                await showAlert("Il formato del tempo sveglio non è valido (HH:MM).");
                return;
            }

            const parsedDeep = sleepDeep ? Logic.parseSleepInput(sleepDeep) || undefined : undefined;
            const parsedLight = sleepLight ? Logic.parseSleepInput(sleepLight) || undefined : undefined;
            const parsedRem = sleepRem ? Logic.parseSleepInput(sleepRem) || undefined : undefined;
            const parsedAwake = sleepAwake ? Logic.parseSleepInput(sleepAwake) || undefined : undefined;
            const targetDate = editingDate || selectedDate;

            if (!isCurrentSession(session)) throw new Error('Sessione cambiata');
            await dispatchDomainOperation({
                type: 'nutrition-day.patch',
                date: targetDate,
                patch: {
                    sleepHours: parsedHours,
                    sleepDeep: parsedDeep,
                    sleepLight: parsedLight,
                    sleepRem: parsedRem,
                    sleepAwake: parsedAwake,
                },
            });
            if (!isCurrentSession(session)) return false;
            const cleared = draft.clear(submitted);
            await showAlert(`Dati sonno salvati per il ${targetDate}!`);
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
