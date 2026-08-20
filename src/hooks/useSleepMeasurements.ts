import { useState, useEffect } from 'react';
import { useAppStore } from '../store/useAppStore';
import { useDialogStore } from '../store/useDialogStore';
import { Logic } from '../lib/logic';

const EMPTY_NUTRITION = {};

export function useSleepMeasurements() {
    const nutrition = useAppStore(state => state.userData?.nutrition || EMPTY_NUTRITION);
    const saveUserData = useAppStore(state => state.saveUserData);
    const showAlert = useDialogStore(state => state.showAlert);
    
    const [editingDate, setEditingDate] = useState<string | null>(null);
    const [sleepHours, setSleepHours] = useState('');
    const [sleepDeep, setSleepDeep] = useState('');
    const [sleepLight, setSleepLight] = useState('');
    const [sleepRem, setSleepRem] = useState('');
    const [sleepAwake, setSleepAwake] = useState('');

    const todayDateStr = Logic.getLocalDateString();

    useEffect(() => {
        const targetDate = editingDate || todayDateStr;
        const targetData = (nutrition as any)[targetDate];

        if (targetData) {
            setSleepHours(targetData.sleepHours !== undefined && targetData.sleepHours !== null ? targetData.sleepHours.toString() : '');
            setSleepDeep(targetData.sleepDeep !== undefined && targetData.sleepDeep !== null ? targetData.sleepDeep.toString() : '');
            setSleepLight(targetData.sleepLight !== undefined && targetData.sleepLight !== null ? targetData.sleepLight.toString() : '');
            setSleepRem(targetData.sleepRem !== undefined && targetData.sleepRem !== null ? targetData.sleepRem.toString() : '');
            setSleepAwake(targetData.sleepAwake !== undefined && targetData.sleepAwake !== null ? targetData.sleepAwake.toString() : '');
        } else {
            setSleepHours('');
            setSleepDeep('');
            setSleepLight('');
            setSleepRem('');
            setSleepAwake('');
        }
    }, [todayDateStr, nutrition, editingDate]);

    const saveSleep = async (e?: any) => {
        if (e) e.preventDefault();
        
        if (!sleepHours || isNaN(parseFloat(sleepHours))) {
            await showAlert("Le ore di sonno sono obbligatorie e devono essere un numero valido.");
            return;
        }

        const targetDate = editingDate || todayDateStr;

        try {
            await saveUserData((prev) => {
                if (!prev) return prev;
                const existingDay = prev.nutrition?.[targetDate] || { date: targetDate, kcal: 0, carbs: 0, pro: 0, fat: 0, meals: [] };
                const updatedDay = {
                    ...existingDay,
                    sleepHours: parseFloat(sleepHours),
                    sleepDeep: sleepDeep ? parseFloat(sleepDeep) : undefined,
                    sleepLight: sleepLight ? parseFloat(sleepLight) : undefined,
                    sleepRem: sleepRem ? parseFloat(sleepRem) : undefined,
                    sleepAwake: sleepAwake ? parseFloat(sleepAwake) : undefined,
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
        sleepHours, setSleepHours,
        sleepDeep, setSleepDeep,
        sleepLight, setSleepLight,
        sleepRem, setSleepRem,
        sleepAwake, setSleepAwake,
        saveSleep
    };
}
