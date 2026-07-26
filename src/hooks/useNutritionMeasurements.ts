import { useState } from 'react';
import { useAppStore } from '../store/useAppStore';
import { Logic } from '../lib/logic';

export function useNutritionMeasurements() {
    const { userData, saveUserData } = useAppStore();
    
    const profile = userData?.profile || {};
    const [weight, setWeight] = useState('');
    const [waist, setWaist] = useState('');
    const [neck, setNeck] = useState('');
    const [hip, setHip] = useState(''); // Solo per donne
    const [manualBf, setManualBf] = useState('');
    const [method, setMethod] = useState(profile.gender === 'F' ? 'navy_female' : 'navy_male');

    const todayDateStr = Logic.getLocalDateString();

    const calculateAndSave = () => {
        if (!weight) {
            alert("Inserisci il peso corporeo.");
            return;
        }

        let bf = null;
        if (method === 'manual') {
            if (!manualBf) { alert("Inserisci la percentuale di massa grassa manuale."); return; }
            bf = parseFloat(manualBf);
        } else {
            if (!waist || !neck || !profile.height) {
                alert("Compila tutti i campi (incluso altezza nei Dati Biometrici).");
                return;
            }
            if (method === 'navy_female' && !hip) {
                alert("Per le donne, inserisci la circonferenza dei fianchi.");
                return;
            }
            // Correct method names: 'navy_male' | 'navy_female'
            bf = Logic.calculateBodyFatByMethod(method, {
                height: parseFloat(profile.height),
                waist: parseFloat(waist),
                neck: parseFloat(neck),
                hip: hip ? parseFloat(hip) : undefined
            });
        }

        if (bf === null || isNaN(bf)) {
            alert("Impossibile calcolare la massa grassa con i dati forniti. Verifica che vita > collo.");
            return;
        }

        const newNutrition = { ...(userData.nutrition || {}) };
        if (!newNutrition[todayDateStr]) {
            newNutrition[todayDateStr] = { kcal: 0, carbs: 0, pro: 0, fat: 0, meals: [] };
        }
        
        newNutrition[todayDateStr].weight = parseFloat(weight);
        if (waist) newNutrition[todayDateStr].waist = parseFloat(waist);
        if (neck) newNutrition[todayDateStr].neck = parseFloat(neck);
        if (hip && profile.gender === 'F') newNutrition[todayDateStr].hip = parseFloat(hip);
        newNutrition[todayDateStr].bf = Math.round(bf * 10) / 10;

        saveUserData({ ...userData, nutrition: newNutrition });
        alert(`Misurazione salvata! BF Calcolata: ${Number(bf).toFixed(1)}%`);
    };

    return {
        profile,
        weight, setWeight,
        waist, setWaist,
        neck, setNeck,
        hip, setHip,
        manualBf, setManualBf,
        method, setMethod,
        calculateAndSave
    };
}
