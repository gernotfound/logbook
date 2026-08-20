import { useState, useEffect } from 'react';
import { useAppStore } from '../store/useAppStore';
import { useDialogStore } from '../store/useDialogStore';
import { Logic } from '../lib/logic';

const EMPTY_NUTRITION = {};

export function useSleepMeasurements() {
    const nutrition = useAppStore(state => state.userData?.nutrition || EMPTY_NUTRITION);
    const saveUserData = useAppStore(state => state.saveUserData);
    const showAlert = useDialogStore(state => state.showAlert);
    
    const todayDateStr = Logic.getLocalDateString();

    const [editingDate, setEditingDate] = useState<string | null>(null);
    const [selectedDate, setSelectedDate] = useState<string>(todayDateStr);
    const [sleepHours, setSleepHours] = useState('');
    const [sleepDeep, setSleepDeep] = useState('');
    const [sleepLight, setSleepLight] = useState('');
    const [sleepRem, setSleepRem] = useState('');
    const [sleepAwake, setSleepAwake] = useState('');

    useEffect(() => {
        const targetDate = editingDate || selectedDate;
        const targetData = (nutrition as any)[targetDate];

        if (targetData) {
            setSleepHours(Logic.formatSleepTime(targetData.sleepHours));
            setSleepDeep(Logic.formatSleepTime(targetData.sleepDeep));
            setSleepLight(Logic.formatSleepTime(targetData.sleepLight));
            setSleepRem(Logic.formatSleepTime(targetData.sleepRem));
            setSleepAwake(Logic.formatSleepTime(targetData.sleepAwake));
        } else {
            setSleepHours('');
            setSleepDeep('');
            setSleepLight('');
            setSleepRem('');
            setSleepAwake('');
        }
    }, [selectedDate, todayDateStr, nutrition, editingDate]);

    const saveSleep = async (e?: any) => {
        if (e) e.preventDefault();
        
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

        try {
            await saveUserData((prev) => {
                if (!prev) return prev;
                const existingDay = prev.nutrition?.[targetDate] || { date: targetDate, kcal: 0, carbs: 0, pro: 0, fat: 0, meals: [] };
                const updatedDay = {
                    ...existingDay,
                    sleepHours: parsedHours,
                    sleepDeep: parsedDeep,
                    sleepLight: parsedLight,
                    sleepRem: parsedRem,
                    sleepAwake: parsedAwake,
                };

                return {
                    ...prev,
                    nutrition: {
                        ...(prev.nutrition || {}),
                        [targetDate]: updatedDay
                    }
                };
            });
            await showAlert(`Dati sonno salvati per il ${targetDate}!`);
            setEditingDate(null);
        } catch {
            await showAlert("Errore durante il salvataggio dei dati del sonno.");
        }
    };

    return {
        editingDate,
        setEditingDate,
        selectedDate,
        setSelectedDate,
        sleepHours, setSleepHours,
        sleepDeep, setSleepDeep,
        sleepLight, setSleepLight,
        sleepRem, setSleepRem,
        sleepAwake, setSleepAwake,
        saveSleep
    };
}

