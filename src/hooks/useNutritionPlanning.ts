import { useState, useEffect } from 'react';
import { useAppStore } from '../store/useAppStore';
import { Logic } from '../lib/logic';

export function useNutritionPlanning() {
    const { userData, saveUserData } = useAppStore();
    
    const [planning, setPlanning] = useState(
        userData?.nutritionPlanning || {
            weight: 80,
            carbsPerKg: 3.5,
            proPerKg: 2.0,
            fatPerKg: 1.0,
            lockedMacro: null,
            chartPeriod: 7,
            normocalorica: { kcal: 2500, carbs: 300, pro: 160, fat: 70 }
        }
    );

    useEffect(() => {
        if (userData?.nutritionPlanning) {
            setPlanning(userData.nutritionPlanning);
        }
    }, [userData?.nutritionPlanning]);

    // Calculate current macros based on settings
    const macros = Logic.calculateMacrosFromKg(
        planning.weight, 
        planning.carbsPerKg, 
        planning.proPerKg, 
        planning.fatPerKg
    );
    const totalKcal = macros.totalKcal;

    const handleUpdate = (field, value) => {
        const newPlanning = { ...planning, [field]: value };
        setPlanning(newPlanning);
    };

    const handleSave = () => {
        // Do NOT overwrite normocalorica. It is manually configured by the user.
        const updatedPlanning = { ...planning };
        setPlanning(updatedPlanning);
        const newUserData = { ...userData, nutritionPlanning: updatedPlanning };
        saveUserData(newUserData);
        alert("Pianificazione salvata sul cloud!");
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
