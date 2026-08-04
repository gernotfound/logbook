import { useState } from 'react';
import { useAppStore } from '../store/useAppStore';
import { useDialogStore } from '../store/useDialogStore';
import { Logic } from '../lib/logic';

export function useNutritionPlanning() {
    const userData = useAppStore(state => state.userData);
    const saveUserData = useAppStore(state => state.saveUserData);
    const showAlert = useDialogStore(state => state.showAlert);
    
    const storePlanning = userData?.nutritionPlanning;
    const [localPlanning, setLocalPlanning] = useState<any>(null);

    const planning = localPlanning ?? storePlanning ?? {
        weight: 80,
        carbsPerKg: 3.5,
        proPerKg: 2.0,
        fatPerKg: 1.0,
        lockedMacro: null,
        chartPeriod: 7,
        normocalorica: { kcal: 2500, carbs: 300, pro: 160, fat: 70 }
    };

    // Calculate current macros based on settings
    const macros = Logic.calculateMacrosFromKg(
        planning.weight, 
        planning.carbsPerKg, 
        planning.proPerKg, 
        planning.fatPerKg
    );
    const totalKcal = macros.totalKcal;

    const handleUpdate = (field: string, value: any) => {
        const newPlanning = { ...planning, [field]: value };
        setLocalPlanning(newPlanning);
    };

    const handleSave = async () => {
        const sanitizedNormo = {
            kcal: parseFloat(planning.normocalorica?.kcal) || 0,
            carbs: parseFloat(planning.normocalorica?.carbs) || 0,
            pro: parseFloat(planning.normocalorica?.pro) || 0,
            fat: parseFloat(planning.normocalorica?.fat) || 0
        };
        const updatedPlanning = {
            ...planning,
            weight: parseFloat(planning.weight) || 80,
            carbsPerKg: parseFloat(planning.carbsPerKg) || 0,
            proPerKg: parseFloat(planning.proPerKg) || 0,
            fatPerKg: parseFloat(planning.fatPerKg) || 0,
            normocalorica: sanitizedNormo
        };
        setLocalPlanning(updatedPlanning);
        const newUserData = { ...userData, nutritionPlanning: updatedPlanning };
        try {
            await saveUserData(newUserData);
            await showAlert("Pianificazione salvata sul cloud!");
        } catch {
            await showAlert("Errore durante il salvataggio della pianificazione.");
        }
    };

    const handleCopyFromTDEE = () => {
        const calc = Logic.calculateTDEEAndMacros(userData);
        const tdee = calc.tdee || 2500;
        const carbs = calc.carbs || 300;
        const pro = calc.pro || 160;
        const fat = calc.fat || 70;
        handleUpdate('normocalorica', { kcal: tdee, carbs, pro, fat });
    };

    return {
        planning, macros, totalKcal,
        handleUpdate, handleSave, handleCopyFromTDEE
    };
}
