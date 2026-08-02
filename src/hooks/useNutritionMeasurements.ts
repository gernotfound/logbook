import { useState, useMemo, useEffect } from 'react';
import { useAppStore } from '../store/useAppStore';
import { useDialogStore } from '../store/useDialogStore';
import { Logic } from '../lib/logic';

export function useNutritionMeasurements() {
    const userData = useAppStore(state => state.userData);
    const saveUserData = useAppStore(state => state.saveUserData);
    const showAlert = useDialogStore(state => state.showAlert);
    
    const profile: any = userData?.profile || {};
    const [editingDate, setEditingDate] = useState<string | null>(null);
    const [weight, setWeight] = useState('');
    const [waist, setWaist] = useState('');
    const [neck, setNeck] = useState('');
    const [hip, setHip] = useState(''); // Solo per donne
    const [manualBf, setManualBf] = useState('');
    const [measureTime, setMeasureTime] = useState(new Date().toTimeString().substring(0, 5));
    const [method, setMethod] = useState(profile.gender === 'F' ? 'navy_female' : 'navy_male');

    const todayDateStr = Logic.getLocalDateString();

    // Restore draft on mount
    useEffect(() => {
        const draft = localStorage.getItem('draft_measurement');
        if (draft) {
            try {
                const parsed = JSON.parse(draft);
                if (parsed.weight) setWeight(parsed.weight);
                if (parsed.waist) setWaist(parsed.waist);
                if (parsed.neck) setNeck(parsed.neck);
                if (parsed.hip) setHip(parsed.hip);
                if (parsed.manualBf) setManualBf(parsed.manualBf);
                if (parsed.measureTime) setMeasureTime(parsed.measureTime);
            } catch {
                // Ignore parse error on invalid draft
            }
        }
    }, []);

    // Save draft on change
    useEffect(() => {
        if (!editingDate) {
            localStorage.setItem('draft_measurement', JSON.stringify({ 
                weight, waist, neck, hip, manualBf, measureTime, method 
            }));
        }
    }, [weight, waist, neck, hip, manualBf, measureTime, method, editingDate]);

    const measurementsHistory = useMemo(() => {
        return Object.values(userData?.nutrition || {})
            .filter((day: any) => day.weight || day.bf)
            .sort((a: any, b: any) => b.date.localeCompare(a.date));
    }, [userData?.nutrition]);

    const handleEditClick = (day: any) => {
        setEditingDate(day.date);
        setWeight(day.weight?.toString() || '');
        setWaist(day.waist?.toString() || '');
        setNeck(day.neck?.toString() || '');
        setHip(day.hip?.toString() || '');
        setManualBf(day.bf?.toString() || '');
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
        setMeasureTime(new Date().toTimeString().substring(0, 5));
        localStorage.removeItem('draft_measurement');
    };

    const calculateAndSave = async () => {
        if (!weight) {
            await showAlert("Inserisci il peso corporeo.");
            return;
        }

        let bf = null;
        if (method === 'manual') {
            if (!manualBf) { await showAlert("Inserisci la percentuale di massa grassa manuale."); return; }
            bf = parseFloat(manualBf);
        } else {
            if (!waist || !neck || !profile.height) {
                await showAlert("Compila tutti i campi (incluso altezza nei Dati Biometrici).");
                return;
            }
            if (method === 'navy_female' && !hip) {
                await showAlert("Per le donne, inserisci la circonferenza dei fianchi.");
                return;
            }
            bf = Logic.calculateBodyFatByMethod(method, {
                height: parseFloat(profile.height),
                waist: parseFloat(waist),
                neck: parseFloat(neck),
                hip: hip ? parseFloat(hip) : undefined
            });
        }

        if (bf === null || isNaN(bf)) {
            await showAlert("Impossibile calcolare la massa grassa con i dati forniti. Verifica che vita > collo.");
            return;
        }

        if (!userData) return;
        const targetDate = editingDate || todayDateStr;
        const existingDay = userData.nutrition?.[targetDate] || { date: targetDate, kcal: 0, carbs: 0, pro: 0, fat: 0, meals: [] };
        
        const updatedDay = {
            ...existingDay,
            weight: parseFloat(weight),
            ...(waist ? { waist: parseFloat(waist) } : {}),
            ...(neck ? { neck: parseFloat(neck) } : {}),
            ...(hip && profile.gender === 'F' ? { hip: parseFloat(hip) } : {}),
            bf: Math.round(bf * 10) / 10,
            measurementTime: measureTime
        };

        const newNutrition = {
            ...(userData.nutrition || {}),
            [targetDate]: updatedDay
        };

        try {
            await saveUserData({ ...userData, nutrition: newNutrition });
            await showAlert(`Misurazione salvata! BF Calcolata: ${Number(bf).toFixed(1)}%`);
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
        method, setMethod,
        measurementsHistory,
        handleEditClick,
        handleCancelEdit,
        calculateAndSave
    };
}
