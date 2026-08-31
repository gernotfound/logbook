import { useState, useMemo, useEffect } from 'react';
import { useAppStore } from '../store/useAppStore';
import { useDialogStore } from '../store/useDialogStore';
import { Logic } from '../lib/logic';

const EMPTY_NUTRITION = {};
const EMPTY_PROFILE = {};

export function useNutritionMeasurements(selectedDate?: string) {
    const profile: any = useAppStore(state => state.userData?.profile || EMPTY_PROFILE);
    const nutrition = useAppStore(state => state.userData?.nutrition || EMPTY_NUTRITION);
    const saveUserData = useAppStore(state => state.saveUserData);
    const showAlert = useDialogStore(state => state.showAlert);
    
    const [editingDate, setEditingDate] = useState<string | null>(null);
    const [weight, setWeight] = useState('');
    const [waist, setWaist] = useState('');
    const [neck, setNeck] = useState('');
    const [hip, setHip] = useState(''); // Solo per donne
    const [manualBf, setManualBf] = useState('');
    const [chest, setChest] = useState('');
    const [shoulders, setShoulders] = useState('');
    const [biceps, setBiceps] = useState('');
    const [thighs, setThighs] = useState('');
    const [calves, setCalves] = useState('');
    const [measureTime, setMeasureTime] = useState(new Date().toTimeString().substring(0, 5));

    const todayDateStr = Logic.getLocalDateString();
    const targetDateStr = selectedDate || editingDate || todayDateStr;
    const isToday = targetDateStr === todayDateStr;

    const targetDayData = (nutrition as any)[targetDateStr];
    const hasExistingData = Boolean(
        targetDayData && (
            (targetDayData.weight !== undefined && targetDayData.weight !== null && targetDayData.weight !== '') ||
            (targetDayData.bf !== undefined && targetDayData.bf !== null && targetDayData.bf !== '') ||
            (targetDayData.waist !== undefined && targetDayData.waist !== null && targetDayData.waist !== '') ||
            (targetDayData.neck !== undefined && targetDayData.neck !== null && targetDayData.neck !== '') ||
            (targetDayData.hip !== undefined && targetDayData.hip !== null && targetDayData.hip !== '') ||
            (targetDayData.chest !== undefined && targetDayData.chest !== null && targetDayData.chest !== '') ||
            (targetDayData.shoulders !== undefined && targetDayData.shoulders !== null && targetDayData.shoulders !== '') ||
            (targetDayData.biceps !== undefined && targetDayData.biceps !== null && targetDayData.biceps !== '') ||
            (targetDayData.thighs !== undefined && targetDayData.thighs !== null && targetDayData.thighs !== '') ||
            (targetDayData.calves !== undefined && targetDayData.calves !== null && targetDayData.calves !== '')
        )
    );

    // Restore draft or day measurements on mount / date switch
    useEffect(() => {
        const dayData = (nutrition as any)[targetDateStr];
        if (isToday && !editingDate) {
            const draft = localStorage.getItem('draft_measurement');
            if (draft) {
                try {
                    const parsed = JSON.parse(draft);
                    setWeight(parsed.weight !== undefined && parsed.weight !== null ? parsed.weight : (dayData?.weight ? dayData.weight.toString() : ''));
                    setWaist(parsed.waist !== undefined && parsed.waist !== null ? parsed.waist : (dayData?.waist ? dayData.waist.toString() : ''));
                    setNeck(parsed.neck !== undefined && parsed.neck !== null ? parsed.neck : (dayData?.neck ? dayData.neck.toString() : ''));
                    setHip(parsed.hip !== undefined && parsed.hip !== null ? parsed.hip : (dayData?.hip ? dayData.hip.toString() : ''));
                    setManualBf(parsed.manualBf !== undefined && parsed.manualBf !== null ? parsed.manualBf : (dayData?.bf ? dayData.bf.toString() : ''));
                    setChest(parsed.chest !== undefined && parsed.chest !== null ? parsed.chest : (dayData?.chest ? dayData.chest.toString() : ''));
                    setShoulders(parsed.shoulders !== undefined && parsed.shoulders !== null ? parsed.shoulders : (dayData?.shoulders ? dayData.shoulders.toString() : ''));
                    setBiceps(parsed.biceps !== undefined && parsed.biceps !== null ? parsed.biceps : (dayData?.biceps ? dayData.biceps.toString() : ''));
                    setThighs(parsed.thighs !== undefined && parsed.thighs !== null ? parsed.thighs : (dayData?.thighs ? dayData.thighs.toString() : ''));
                    setCalves(parsed.calves !== undefined && parsed.calves !== null ? parsed.calves : (dayData?.calves ? dayData.calves.toString() : ''));
                    if (parsed.measureTime) setMeasureTime(parsed.measureTime);
                    else if (dayData?.measurementTime) setMeasureTime(dayData.measurementTime);
                } catch {
                    setWeight(dayData?.weight ? dayData.weight.toString() : '');
                    setWaist(dayData?.waist ? dayData.waist.toString() : '');
                    setNeck(dayData?.neck ? dayData.neck.toString() : '');
                    setHip(dayData?.hip ? dayData.hip.toString() : '');
                    setManualBf(dayData?.bf ? dayData.bf.toString() : '');
                    setChest(dayData?.chest ? dayData.chest.toString() : '');
                    setShoulders(dayData?.shoulders ? dayData.shoulders.toString() : '');
                    setBiceps(dayData?.biceps ? dayData.biceps.toString() : '');
                    setThighs(dayData?.thighs ? dayData.thighs.toString() : '');
                    setCalves(dayData?.calves ? dayData.calves.toString() : '');
                    setMeasureTime(dayData?.measurementTime || new Date().toTimeString().substring(0, 5));
                }
            } else {
                setWeight(dayData?.weight ? dayData.weight.toString() : '');
                setWaist(dayData?.waist ? dayData.waist.toString() : '');
                setNeck(dayData?.neck ? dayData.neck.toString() : '');
                setHip(dayData?.hip ? dayData.hip.toString() : '');
                setManualBf(dayData?.bf ? dayData.bf.toString() : '');
                setChest(dayData?.chest ? dayData.chest.toString() : '');
                setShoulders(dayData?.shoulders ? dayData.shoulders.toString() : '');
                setBiceps(dayData?.biceps ? dayData.biceps.toString() : '');
                setThighs(dayData?.thighs ? dayData.thighs.toString() : '');
                setCalves(dayData?.calves ? dayData.calves.toString() : '');
                setMeasureTime(dayData?.measurementTime || new Date().toTimeString().substring(0, 5));
            }
        } else {
            // For past/future dates or when explicitly editing
            setWeight(dayData?.weight ? dayData.weight.toString() : '');
            setWaist(dayData?.waist ? dayData.waist.toString() : '');
            setNeck(dayData?.neck ? dayData.neck.toString() : '');
            setHip(dayData?.hip ? dayData.hip.toString() : '');
            setManualBf(dayData?.bf ? dayData.bf.toString() : '');
            setChest(dayData?.chest ? dayData.chest.toString() : '');
            setShoulders(dayData?.shoulders ? dayData.shoulders.toString() : '');
            setBiceps(dayData?.biceps ? dayData.biceps.toString() : '');
            setThighs(dayData?.thighs ? dayData.thighs.toString() : '');
            setCalves(dayData?.calves ? dayData.calves.toString() : '');
            setMeasureTime(dayData?.measurementTime || new Date().toTimeString().substring(0, 5));
        }
    }, [targetDateStr, nutrition, isToday, editingDate]);

    // Save draft for today when inputs change
    useEffect(() => {
        if (isToday && !editingDate) {
            localStorage.setItem('draft_measurement', JSON.stringify({ 
                weight, waist, neck, hip, manualBf, chest, shoulders, biceps, thighs, calves, measureTime 
            }));
        }
    }, [weight, waist, neck, hip, manualBf, chest, shoulders, biceps, thighs, calves, measureTime, editingDate, isToday]);

    const measurementsHistory = useMemo(() => {
        return Object.values(nutrition)
            .filter((day: any) => day && (day.weight || day.bf || day.sleepHours))
            .sort((a: any, b: any) => (b.date || '').localeCompare(a.date || ''));
    }, [nutrition]);

    const handleEditClick = (day: any) => {
        setEditingDate(day.date);
        setWeight(day.weight?.toString() || '');
        setWaist(day.waist?.toString() || '');
        setNeck(day.neck?.toString() || '');
        setHip(day.hip?.toString() || '');
        setManualBf(day.bf?.toString() || '');
        setChest(day.chest?.toString() || '');
        setShoulders(day.shoulders?.toString() || '');
        setBiceps(day.biceps?.toString() || '');
        setThighs(day.thighs?.toString() || '');
        setCalves(day.calves?.toString() || '');
        setMeasureTime(day.measurementTime || new Date().toTimeString().substring(0, 5));
        window.scrollTo({ top: 0, behavior: 'smooth' });
    };

    const handleCancelEdit = () => {
        setEditingDate(null);
        if (isToday) {
            localStorage.removeItem('draft_measurement');
        }
        setWeight(targetDayData?.weight ? targetDayData.weight.toString() : '');
        setWaist(targetDayData?.waist ? targetDayData.waist.toString() : '');
        setNeck(targetDayData?.neck ? targetDayData.neck.toString() : '');
        setHip(targetDayData?.hip ? targetDayData.hip.toString() : '');
        setManualBf(targetDayData?.bf ? targetDayData.bf.toString() : '');
        setChest(targetDayData?.chest ? targetDayData.chest.toString() : '');
        setShoulders(targetDayData?.shoulders ? targetDayData.shoulders.toString() : '');
        setBiceps(targetDayData?.biceps ? targetDayData.biceps.toString() : '');
        setThighs(targetDayData?.thighs ? targetDayData.thighs.toString() : '');
        setCalves(targetDayData?.calves ? targetDayData.calves.toString() : '');
        setMeasureTime(targetDayData?.measurementTime || new Date().toTimeString().substring(0, 5));
    };

    const handleDeleteMeasurement = async (dateStr: string) => {
        const confirmed = await useDialogStore.getState().showConfirm(`Sei sicuro di voler eliminare la misurazione del ${Logic.formatItalianDate ? Logic.formatItalianDate(dateStr) : dateStr}?`);
        if (!confirmed) return;
        try {
            await saveUserData((prev) => {
                if (!prev || !prev.nutrition?.[dateStr]) return prev;
                const day = { ...prev.nutrition[dateStr] };
                delete day.weight;
                delete day.bf;
                delete day.waist;
                delete day.neck;
                delete day.hip;
                delete day.chest;
                delete day.shoulders;
                delete day.biceps;
                delete day.thighs;
                delete day.calves;
                delete day.measurementTime;
                return { ...prev, nutrition: { ...prev.nutrition, [dateStr]: day } };
            });
            await showAlert('Misurazione eliminata.');
        } catch {
            await showAlert("Errore durante l'eliminazione.");
        }
    };

    const calculateAndSave = async (e?: any) => {
        if (e) e.preventDefault();
        
        if (!weight || isNaN(parseFloat(weight))) {
            await showAlert("Inserisci un valore valido per il peso.");
            return;
        }

        const height = parseFloat(profile.height);
        let bf: number | null = null;
        
        if (manualBf && !isNaN(parseFloat(manualBf))) {
            bf = parseFloat(manualBf);
        } else if (waist && neck && !isNaN(parseFloat(waist)) && !isNaN(parseFloat(neck))) {
            if (height && !isNaN(height)) {
                bf = Logic.calculateBodyFatByMethod(profile.gender === 'F' ? 'navy_female' : 'navy_male', {
                    gender: profile.gender || 'M',
                    height,
                    weight: parseFloat(weight),
                    waist: parseFloat(waist),
                    neck: parseFloat(neck),
                    hip: hip ? parseFloat(hip) : undefined
                });
                
                if (bf === null || isNaN(bf)) {
                    await showAlert("Impossibile calcolare la massa grassa con i dati forniti. Verifica che vita > collo.");
                    return;
                }
            } else {
                await showAlert("Attenzione: imposta la tua altezza nelle Impostazioni per calcolare la massa grassa dai perimetri corporei.");
                return;
            }
        }

        const targetDate = targetDateStr;

        try {
            await saveUserData((prev) => {
                if (!prev) return prev;
                const existingDay = prev.nutrition?.[targetDate] || { date: targetDate, kcal: 0, carbs: 0, pro: 0, fat: 0, meals: [] };
                const updatedDay = {
                    ...existingDay,
                    weight: parseFloat(weight),
                    ...(waist ? { waist: parseFloat(waist) } : {}),
                    ...(neck ? { neck: parseFloat(neck) } : {}),
                    ...(hip && profile.gender === 'F' ? { hip: parseFloat(hip) } : {}),
                    ...(chest ? { chest: parseFloat(chest) } : {}),
                    ...(shoulders ? { shoulders: parseFloat(shoulders) } : {}),
                    ...(biceps ? { biceps: parseFloat(biceps) } : {}),
                    ...(thighs ? { thighs: parseFloat(thighs) } : {}),
                    ...(calves ? { calves: parseFloat(calves) } : {}),
                    ...(bf !== null && !isNaN(bf) ? { bf: Math.round(bf * 10) / 10 } : {}),
                    measurementTime: measureTime
                };
                return {
                    ...prev,
                    nutrition: {
                        ...(prev.nutrition || {}),
                        [targetDate]: updatedDay
                    }
                };
            });
            if (bf !== null && !isNaN(bf)) {
                await showAlert(`Misurazione salvata! BF: ${Number(bf).toFixed(1)}%`);
            } else {
                await showAlert(`Peso salvato correttamente!`);
            }
            if (isToday) {
                localStorage.removeItem('draft_measurement');
            }
            setEditingDate(null);
        } catch {
            await showAlert("Errore durante il salvataggio della misurazione.");
        }
    };

    return {
        profile,
        targetDateStr,
        selectedDate,
        editingDate,
        setEditingDate,
        hasExistingData,
        measureTime, setMeasureTime,
        weight, setWeight,
        waist, setWaist,
        neck, setNeck,
        hip, setHip,
        manualBf, setManualBf,
        chest, setChest,
        shoulders, setShoulders,
        biceps, setBiceps,
        thighs, setThighs,
        calves, setCalves,
        measurementsHistory,
        handleEditClick,
        handleCancelEdit,
        calculateAndSave,
        handleDeleteMeasurement
    };
}

