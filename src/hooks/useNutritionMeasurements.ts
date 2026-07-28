import { useState } from 'react';
import { useAppStore } from '../store/useAppStore';
import { useDialogStore } from '../store/useDialogStore';
import { Logic } from '../lib/logic';

export function useNutritionMeasurements() {
    const { userData, saveUserData } = useAppStore();
    const { showAlert } = useDialogStore();
    
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

    const measurementsHistory = Object.values(userData?.nutrition || {})
        .filter((day: any) => day.weight || day.bf)
        .sort((a: any, b: any) => b.date.localeCompare(a.date));

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
        const newNutrition = { ...(userData.nutrition || {}) };
        if (!newNutrition[targetDate]) {
            newNutrition[targetDate] = { date: targetDate, kcal: 0, carbs: 0, pro: 0, fat: 0, meals: [] };
        }
        
        newNutrition[targetDate].weight = parseFloat(weight);
        if (waist) newNutrition[targetDate].waist = parseFloat(waist);
        if (neck) newNutrition[targetDate].neck = parseFloat(neck);
        if (hip && profile.gender === 'F') newNutrition[targetDate].hip = parseFloat(hip);
        newNutrition[targetDate].bf = Math.round(bf * 10) / 10;
        newNutrition[targetDate].measurementTime = measureTime;

        saveUserData({ ...userData, nutrition: newNutrition });
        await showAlert(`Misurazione salvata! BF Calcolata: ${Number(bf).toFixed(1)}%`);
        handleCancelEdit();
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
