import { useState } from 'react';
import { useAppStore } from '../store/useAppStore';
import { useDialogStore } from '../store/useDialogStore';
import { COMMON_FOODS } from '../lib/foods';
import { Logic } from '../lib/logic';

export function useNutritionMeals() {
    const userData = useAppStore(state => state.userData);
    const saveUserData = useAppStore(state => state.saveUserData);
    const showAlert = useDialogStore(state => state.showAlert);
    
    const [searchQuery, setSearchQuery] = useState('');
    const [searchResults, setSearchResults] = useState<any[]>([]);
    
    const [showCustomModal, setShowCustomModal] = useState(false);
    const [cfData, setCfData] = useState({
        name: '', brand: '', unit: 'g', pieceWeight: '',
        kcal: '', carbs: '', pro: '', fat: ''
    });

    const todayDateStr = Logic.getLocalDateString();
    const todayNutrition = userData?.nutrition?.[todayDateStr] || { 
        date: todayDateStr, kcal: 0, carbs: 0, pro: 0, fat: 0, meals: [] 
    };
    
    const meals = (todayNutrition.meals || []) as any[];

    const handleQuickAdd = async (quickData: any) => {
        if (!userData) return;
        const addedItem = {
            id: Date.now(),
            name: quickData.name,
            meal: 'quick',
            quantity: 100,
            baseQty: 100,
            unit: 'g',
            kcal: quickData.kcal || 0,
            carbs: quickData.carbs || 0,
            pro: quickData.pro || 0,
            fat: quickData.fat || 0,
            time: new Date().getTime()
        };

        const updatedMeals = [...meals, addedItem];
        const { kcal, carbs, pro, fat } = recalcTotals(updatedMeals);

        const newNutritionDay = {
            ...todayNutrition,
            meals: updatedMeals,
            kcal, carbs, pro, fat
        };

        const newNutritionObj = { ...(userData.nutrition || {}), [todayDateStr]: newNutritionDay };
        try {
            await saveUserData({ ...userData, nutrition: newNutritionObj });
        } catch {
            showAlert("Errore durante il salvataggio dell'alimento.");
        }
    };

    const handleSearch = (query: string) => {
        setSearchQuery(query);
        if (query.trim().length > 1) {
            const q = query.toLowerCase();
            const customFoods = userData?.customFoods || [];
            const combined = [...COMMON_FOODS, ...customFoods];
            const res = combined.filter((f: any) => 
                (f.name || '').toLowerCase().includes(q) || 
                (f.category || '').toLowerCase().includes(q) ||
                (f.brand || '').toLowerCase().includes(q)
            ).slice(0, 10);
            setSearchResults(res);
        } else {
            setSearchResults([]);
        }
    };

    const recalcTotals = (mealsList: any[]) => {
        let kcal = 0, carbs = 0, pro = 0, fat = 0;
        mealsList.forEach((m: any) => {
            const qty = m.quantity ?? m.baseQty ?? 100;
            const base = m.baseQty ?? 100;
            const ratio = qty / base;
            kcal += (parseFloat(m.kcal) || 0) * ratio;
            carbs += (parseFloat(m.carbs) || 0) * ratio;
            pro += (parseFloat(m.pro) || 0) * ratio;
            fat += (parseFloat(m.fat) || 0) * ratio;
        });
        return {
            kcal: Math.round(kcal),
            carbs: Math.round(carbs * 10) / 10,
            pro: Math.round(pro * 10) / 10,
            fat: Math.round(fat * 10) / 10
        };
    };

    const addFood = async (food: any, mealType: string) => {
        if (!userData) return;
        const addedItem = {
            id: food.id,
            name: food.name,
            meal: mealType,
            quantity: food.baseQty || 100,
            baseQty: food.baseQty || 100,
            unit: food.unit || 'g',
            kcal: food.kcal || 0,
            carbs: food.carbs || 0,
            pro: food.pro || 0,
            fat: food.fat || 0,
            time: new Date().getTime()
        };

        const updatedMeals = [...meals, addedItem];
        const { kcal, carbs, pro, fat } = recalcTotals(updatedMeals);

        const newNutritionDay = {
            ...todayNutrition,
            meals: updatedMeals,
            kcal, carbs, pro, fat
        };

        const newNutritionObj = { ...(userData.nutrition || {}), [todayDateStr]: newNutritionDay };
        try {
            await saveUserData({ ...userData, nutrition: newNutritionObj });
            setSearchQuery('');
        } catch {
            showAlert("Errore durante il salvataggio dell'alimento.");
        }
    };

    const clearSearch = () => {
        setSearchQuery('');
    };

    const removeFood = async (itemTime: number) => {
        if (!userData) return;
        const updatedMeals = meals.filter((m: any) => m.time !== itemTime);
        const { kcal, carbs, pro, fat } = recalcTotals(updatedMeals);

        const newNutritionDay = {
            ...todayNutrition,
            meals: updatedMeals,
            kcal, carbs, pro, fat
        };

        const newNutritionObj = { ...(userData.nutrition || {}), [todayDateStr]: newNutritionDay };
        try {
            await saveUserData({ ...userData, nutrition: newNutritionObj });
        } catch {
            showAlert("Errore durante la rimozione dell'alimento.");
        }
    };

    const handleDeleteItem = async (itemTime: number) => {
        removeFood(itemTime);
    };

    const clearDay = async () => {
        if (!userData) return;
        const newNutritionDay = {
            date: todayDateStr, kcal: 0, carbs: 0, pro: 0, fat: 0, meals: []
        };
        const newNutritionObj = { ...(userData.nutrition || {}), [todayDateStr]: newNutritionDay };
        try {
            await saveUserData({ ...userData, nutrition: newNutritionObj });
        } catch {
            showAlert("Errore durante la pulizia della giornata.");
        }
    };

    const saveCustomFood = async () => {
        if (!userData) return;
        const foodData = {
            ...cfData,
            baseQty: 100,
            servingWeight: cfData.unit === 'pezzo' ? cfData.pieceWeight : null
        };
        
        const validation = Logic.validateCustomFood(foodData);
        if (!validation.isValid) {
            await showAlert("Attenzione: errori nei dati dell'alimento:\n" + Object.values(validation.errors).join('\n'));
            return;
        }

        const customFoods = userData?.customFoods || [];
        if (validation.cleanData) {
            const updatedCustomFoods = [...customFoods, validation.cleanData];
            try {
                await saveUserData({ ...userData, customFoods: updatedCustomFoods });
                setShowCustomModal(false);
                setCfData({ name: '', brand: '', unit: 'g', pieceWeight: '', kcal: '', carbs: '', pro: '', fat: '' });
                await showAlert("Alimento custom salvato!");
            } catch {
                await showAlert("Errore durante il salvataggio dell'alimento custom.");
            }
        }
    };

    return {
        searchQuery, setSearchQuery, handleSearch, searchResults, handleDeleteItem, clearSearch,
        clearDay,
        handleQuickAdd,
        showCustomModal, setShowCustomModal,
        cfData, setCfData, saveCustomFood,
        meals, addFood, removeFood
    };
}
