import { useState } from 'react';
import { useAppStore } from '../store/useAppStore';
import { useDialogStore } from '../store/useDialogStore';
import { Logic } from '../lib/logic';
import type { NutritionPlanning } from '../types';

export function useNutritionPlanning() {
    const storePlanning = useAppStore(state => state.userData?.nutritionPlanning);
    const saveUserData = useAppStore(state => state.saveUserData);
    const showAlert = useDialogStore(state => state.showAlert);
    const userData = useAppStore(state => state.userData);
    
    const [localPlanning, setLocalPlanning] = useState<NutritionPlanning | null>(null);

    // Trova l'ultimo peso inserito nello storico nutrizione/misurazioni
    let latestWeight = 80;
    if (userData?.nutrition) {
        const dates = Object.keys(userData.nutrition).sort((a, b) => b.localeCompare(a));
        for (const d of dates) {
            if (userData.nutrition[d].weight) {
                latestWeight = parseFloat(userData.nutrition[d].weight as string) || latestWeight;
                break;
            }
        }
    }

    const defaultPlanning: NutritionPlanning = {
        weight: latestWeight,
        onDaysCount: 4,
        avgMacros: storePlanning?.avgMacros || { carbsPerKg: 3.5, proPerKg: 2.0, fatPerKg: 1.0 },
        onBoost: storePlanning?.onBoost || { carbsPercent: 20, proPercent: 0, fatPercent: 0 },
        normocalorica: storePlanning?.normocalorica || { kcal: 2500, carbs: 300, pro: 160, fat: 70 }
    };

    const planning = localPlanning ?? storePlanning ?? defaultPlanning;
    
    // Assicura l'esistenza degli oggetti
    if (!planning.avgMacros) planning.avgMacros = defaultPlanning.avgMacros;
    if (!planning.onBoost) planning.onBoost = defaultPlanning.onBoost;
    if (planning.onDaysCount === undefined) planning.onDaysCount = 4;
    if (!planning.weight) planning.weight = latestWeight;

    // Calcolo matematico dei macro ON e OFF
    const N = planning.onDaysCount || 0;
    const F = 7 - N;
    
    const avgC = planning.avgMacros!.carbsPerKg;
    const bC = planning.onBoost!.carbsPercent / 100;
    const offC = (N > 0 && N < 7) ? (7 * avgC) / (N * (1 + bC) + F) : avgC;
    const onC = (N > 0 && N < 7) ? offC * (1 + bC) : avgC;

    const avgP = planning.avgMacros!.proPerKg;
    const bP = planning.onBoost!.proPercent / 100;
    const offP = (N > 0 && N < 7) ? (7 * avgP) / (N * (1 + bP) + F) : avgP;
    const onP = (N > 0 && N < 7) ? offP * (1 + bP) : avgP;

    const avgF = planning.avgMacros!.fatPerKg;
    const bF = planning.onBoost!.fatPercent / 100;
    const offF = (N > 0 && N < 7) ? (7 * avgF) / (N * (1 + bF) + F) : avgF;
    const onF = (N > 0 && N < 7) ? offF * (1 + bF) : avgF;

    // Aggiorniamo dinamicamente onMacros e offMacros
    const currentOnMacros = { carbsPerKg: onC, proPerKg: onP, fatPerKg: onF };
    const currentOffMacros = { carbsPerKg: offC, proPerKg: offP, fatPerKg: offF };

    const w = planning.weight;
    const onMacrosCalc = Logic.calculateMacrosFromKg(w, onC, onP, onF);
    const offMacrosCalc = Logic.calculateMacrosFromKg(w, offC, offP, offF);
    const avgMacrosCalc = Logic.calculateMacrosFromKg(w, avgC, avgP, avgF);
    
    // Calcolo automatico in tempo reale
    const tdeeCalc = Logic.calculateTDEEAndMacros(userData);

    const handleUpdate = (field: string, value: any) => {
        setLocalPlanning({ ...planning, [field]: value });
    };

    const handleUpdateAvgMacros = (field: string, value: string) => {
        setLocalPlanning({
            ...planning,
            avgMacros: { ...planning.avgMacros!, [field]: value === '' ? '' : parseFloat(value) }
        } as any);
    };

    const handleUpdateOnBoost = (field: string, value: string) => {
        setLocalPlanning({
            ...planning,
            onBoost: { ...planning.onBoost!, [field]: value === '' ? '' : parseFloat(value) }
        } as any);
    };

    const handleSave = async (e?: any) => {
        if (e) e.preventDefault();
        const sanitizedNormo = {
            kcal: parseFloat(planning.normocalorica?.kcal as any) || 0,
            carbs: parseFloat(planning.normocalorica?.carbs as any) || 0,
            pro: parseFloat(planning.normocalorica?.pro as any) || 0,
            fat: parseFloat(planning.normocalorica?.fat as any) || 0
        };

        const updatedPlanning = {
            ...planning,
            weight: parseFloat(planning.weight as any) || latestWeight,
            onDaysCount: parseInt(planning.onDaysCount as any) || 4,
            normocalorica: sanitizedNormo,
            // Convert to numbers safely
            avgMacros: {
                carbsPerKg: parseFloat(planning.avgMacros!.carbsPerKg as any) || 0,
                proPerKg: parseFloat(planning.avgMacros!.proPerKg as any) || 0,
                fatPerKg: parseFloat(planning.avgMacros!.fatPerKg as any) || 0
            },
            onBoost: {
                carbsPercent: parseFloat(planning.onBoost!.carbsPercent as any) || 0,
                proPercent: parseFloat(planning.onBoost!.proPercent as any) || 0,
                fatPercent: parseFloat(planning.onBoost!.fatPercent as any) || 0
            },
            // Salva i target on/off in modo che HomeView e Pasti li leggano come sempre
            onMacros: currentOnMacros,
            offMacros: currentOffMacros
        };
        
        setLocalPlanning(updatedPlanning);
        try {
            await saveUserData(prev => ({ ...prev, nutritionPlanning: updatedPlanning }));
            await showAlert("Pianificazione salvata sul cloud!");
        } catch {
            await showAlert("Errore durante il salvataggio della pianificazione.");
        }
    };

    return {
        planning, 
        onMacrosCalc, offMacrosCalc, avgMacrosCalc, tdeeCalc,
        currentOnMacros, currentOffMacros,
        handleUpdate, handleUpdateAvgMacros, handleUpdateOnBoost, handleSave
    };
}
