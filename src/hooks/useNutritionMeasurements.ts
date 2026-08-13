import { useState, useMemo, useEffect } from 'react';
import { useAppStore } from '../store/useAppStore';
import { useDialogStore } from '../store/useDialogStore';
import { Logic } from '../lib/logic';

const EMPTY_NUTRITION = {};
const EMPTY_PROFILE = {};

export function useNutritionMeasurements() {
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

    // Restore draft on mount
    useEffect(() => {
        const draft = localStorage.getItem('draft_measurement');
        const todayData = (nutrition as any)[todayDateStr];
        
        if (draft) {
            try {
                const parsed = JSON.parse(draft);
                if (parsed.weight) setWeight(parsed.weight);
                else if (todayData?.weight) setWeight(todayData.weight.toString());
                
                if (parsed.waist) setWaist(parsed.waist);
                else if (todayData?.waist) setWaist(todayData.waist.toString());
                
                if (parsed.neck) setNeck(parsed.neck);
                else if (todayData?.neck) setNeck(todayData.neck.toString());
                
                if (parsed.hip) setHip(parsed.hip);
                else if (todayData?.hip) setHip(todayData.hip.toString());
                
                if (parsed.manualBf) setManualBf(parsed.manualBf);
                else if (todayData?.bf) setManualBf(todayData.bf.toString());
                
                if (parsed.chest) setChest(parsed.chest);
                else if (todayData?.chest) setChest(todayData.chest.toString());
                
                if (parsed.shoulders) setShoulders(parsed.shoulders);
                else if (todayData?.shoulders) setShoulders(todayData.shoulders.toString());
                
                if (parsed.biceps) setBiceps(parsed.biceps);
                else if (todayData?.biceps) setBiceps(todayData.biceps.toString());
                
                if (parsed.thighs) setThighs(parsed.thighs);
                else if (todayData?.thighs) setThighs(todayData.thighs.toString());
                
                if (parsed.calves) setCalves(parsed.calves);
                else if (todayData?.calves) setCalves(todayData.calves.toString());
                
                if (parsed.measureTime) setMeasureTime(parsed.measureTime);
            } catch {
                if (todayData?.weight) setWeight(todayData.weight.toString());
                if (todayData?.waist) setWaist(todayData.waist.toString());
                if (todayData?.neck) setNeck(todayData.neck.toString());
                if (todayData?.bf) setManualBf(todayData.bf.toString());
                if (todayData?.chest) setChest(todayData.chest.toString());
                if (todayData?.shoulders) setShoulders(todayData.shoulders.toString());
                if (todayData?.biceps) setBiceps(todayData.biceps.toString());
                if (todayData?.thighs) setThighs(todayData.thighs.toString());
                if (todayData?.calves) setCalves(todayData.calves.toString());
            }
        } else {
            if (todayData?.weight) setWeight(todayData.weight.toString());
            if (todayData?.waist) setWaist(todayData.waist.toString());
            if (todayData?.neck) setNeck(todayData.neck.toString());
            if (todayData?.hip) setHip(todayData.hip.toString());
            if (todayData?.bf) setManualBf(todayData.bf.toString());
            if (todayData?.chest) setChest(todayData.chest.toString());
            if (todayData?.shoulders) setShoulders(todayData.shoulders.toString());
            if (todayData?.biceps) setBiceps(todayData.biceps.toString());
            if (todayData?.thighs) setThighs(todayData.thighs.toString());
            if (todayData?.calves) setCalves(todayData.calves.toString());
        }
    }, [todayDateStr]);

    useEffect(() => {
        if (!editingDate) {
            localStorage.setItem('draft_measurement', JSON.stringify({ 
                weight, waist, neck, hip, manualBf, chest, shoulders, biceps, thighs, calves, measureTime 
            }));
        }
    }, [weight, waist, neck, hip, manualBf, chest, shoulders, biceps, thighs, calves, measureTime, editingDate]);

    const measurementsHistory = useMemo(() => {
        return Object.values(nutrition)
            .filter((day: any) => day && (day.weight || day.bf))
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
        setWeight('');
        setWaist('');
        setNeck('');
        setHip('');
        setManualBf('');
        setChest('');
        setShoulders('');
        setBiceps('');
        setThighs('');
        setCalves('');
        setMeasureTime(new Date().toTimeString().substring(0, 5));
        localStorage.removeItem('draft_measurement');
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

        const targetDate = editingDate || todayDateStr;

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
            handleCancelEdit();
        } catch {
            await showAlert("Errore durante il salvataggio della misurazione.");
        }
    };

    return {
        profile,
        editingDate,
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
        calculateAndSave
    };
}
