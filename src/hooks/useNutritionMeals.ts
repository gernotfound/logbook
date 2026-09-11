import { useState } from 'react';
import { useAppStore } from '../store/useAppStore';
import { useDialogStore } from '../store/useDialogStore';
import { Logic } from '../lib/logic';

const EMPTY_FOODS: any[] = [];
const DEFAULT_NUTRITION = { kcal: 0, carbs: 0, pro: 0, fat: 0, meals: [] };

export function useNutritionMeals(dateStr?: string) {
    const targetDateStr = dateStr || Logic.getLocalDateString();
    const storeNutrition = useAppStore(state => state.userData?.nutrition?.[targetDateStr]);
    const todayNutrition = storeNutrition || { ...DEFAULT_NUTRITION, date: targetDateStr };
    const customFoods = useAppStore(state => state.userData?.customFoods || EMPTY_FOODS);
    const saveUserData = useAppStore(state => state.saveUserData);
    const showAlert = useDialogStore(state => state.showAlert);
    
    const [searchQuery, setSearchQuery] = useState('');
    const [searchResults, setSearchResults] = useState<any[]>([]);
    
    const [showCustomModal, setShowCustomModal] = useState(false);
    const [editingFoodId, setEditingFoodId] = useState<string | number | null>(null);
    const [cfData, setCfData] = useState({
        name: '', brand: '', unit: 'g', pieceWeight: '',
        kcal: '', carbs: '', pro: '', fat: ''
    });

    const planning = useAppStore(state => state.userData?.nutritionPlanning);
    const nutritionMap = useAppStore(state => state.userData?.nutrition);
    
    // Local override per non sporcare il database quando la giornata è vuota
    const [localDayOnMap, setLocalDayOnMap] = useState<Record<string, boolean>>({});
    const dbIsDayOn = todayNutrition.isDayOn;
    const isDayOn = localDayOnMap[targetDateStr] !== undefined ? localDayOnMap[targetDateStr] : (dbIsDayOn ?? true);

    let latestWeight = 80;
    if (nutritionMap) {
        const dates = Object.keys(nutritionMap).sort((a, b) => b.localeCompare(a));
        for (const d of dates) {
            if (nutritionMap[d].weight) {
                latestWeight = parseFloat(nutritionMap[d].weight as string) || latestWeight;
                break;
            }
        }
    }

    let dailyTarget = { kcal: 0, carbs: 0, pro: 0, fat: 0 };
    if (planning) {
        const w = planning.weight || latestWeight;
        const targetMacros = isDayOn ? planning.onMacros : planning.offMacros;
        if (targetMacros) {
            const calc = Logic.calculateMacrosFromKg(w, targetMacros.carbsPerKg, targetMacros.proPerKg, targetMacros.fatPerKg);
            dailyTarget = {
                kcal: Math.round(calc.totalKcal),
                carbs: Math.round(calc.carbsGrams),
                pro: Math.round(calc.proGrams),
                fat: Math.round(calc.fatGrams)
            };
        }
    }

    const toggleDayType = async () => {
        const newIsOn = !isDayOn;
        setLocalDayOnMap(prev => ({ ...prev, [targetDateStr]: newIsOn }));
        
        // Se ci sono già dati, salviamo anche sul cloud, altrimenti manteniamo solo locale
        if ((todayNutrition.meals && todayNutrition.meals.length > 0) || dbIsDayOn !== undefined || todayNutrition.weight) {
            try {
                await saveUserData((prev) => {
                    if (!prev) return prev;
                    const todayData = prev.nutrition?.[targetDateStr] || { date: targetDateStr, kcal: 0, carbs: 0, pro: 0, fat: 0, meals: [] };
                    return { ...prev, nutrition: { ...(prev.nutrition || {}), [targetDateStr]: { ...todayData, isDayOn: newIsOn } } };
                });
            } catch {
                showAlert("Errore durante il salvataggio.");
            }
        }
    };

    const setDayType = async (isOn: boolean) => {
        if (isDayOn === isOn) return;
        setLocalDayOnMap(prev => ({ ...prev, [targetDateStr]: isOn }));
        
        if ((todayNutrition.meals && todayNutrition.meals.length > 0) || dbIsDayOn !== undefined || todayNutrition.weight) {
            try {
                await saveUserData((prev) => {
                    if (!prev) return prev;
                    const todayData = prev.nutrition?.[targetDateStr] || { date: targetDateStr, kcal: 0, carbs: 0, pro: 0, fat: 0, meals: [] };
                    return { ...prev, nutrition: { ...(prev.nutrition || {}), [targetDateStr]: { ...todayData, isDayOn: isOn } } };
                });
            } catch {
                showAlert("Errore durante il salvataggio.");
            }
        }
    };

    const meals = (todayNutrition.meals || []) as any[];

    const startEditCustomFood = (food: any) => {
        setEditingFoodId(food.id);
        setCfData({
            name: food.name || '',
            brand: food.brand || '',
            unit: food.unit || 'g',
            pieceWeight: food.servingWeight || food.pieceWeight || '',
            kcal: food.kcal !== undefined ? food.kcal.toString() : '',
            carbs: food.carbs !== undefined ? food.carbs.toString() : '',
            pro: food.pro !== undefined ? food.pro.toString() : '',
            fat: food.fat !== undefined ? food.fat.toString() : ''
        });
        setShowCustomModal(true);
    };

    const cancelCustomFood = () => {
        setShowCustomModal(false);
        setEditingFoodId(null);
        setCfData({ name: '', brand: '', unit: 'g', pieceWeight: '', kcal: '', carbs: '', pro: '', fat: '' });
    };

    const handleQuickAdd = async (quickData: any) => {
        const addedItem = {
            id: Logic.generateId('food'),
            name: quickData.name,
            meal: 'quick',
            quantity: 1,
            baseQty: 1,
            unit: 'porzione',
            kcal: quickData.kcal || 0,
            carbs: quickData.carbs || 0,
            pro: quickData.pro || 0,
            fat: quickData.fat || 0,
            time: new Date().getTime()
        };

        try {
            await saveUserData((prev) => {
                if (!prev) return prev;
                const todayData = prev.nutrition?.[targetDateStr] || { date: targetDateStr, kcal: 0, carbs: 0, pro: 0, fat: 0, meals: [] };
                const currentIsDayOn = localDayOnMap[targetDateStr] !== undefined ? localDayOnMap[targetDateStr] : (todayData.isDayOn ?? true);
                const updatedMeals = [...(todayData.meals || []), addedItem];
                const totals = recalcTotals(updatedMeals);
                return { ...prev, nutrition: { ...(prev.nutrition || {}), [targetDateStr]: { ...todayData, meals: updatedMeals, ...totals, isDayOn: currentIsDayOn } } };
            });
        } catch {
            showAlert("Errore durante il salvataggio dell'alimento.");
        }
    };

    const handleSearch = (query: string) => {
        setSearchQuery(query);
        if (query.trim().length > 0) {
            const res = Logic.searchFoods(customFoods, query).slice(0, 15);
            setSearchResults(res);
        } else {
            setSearchResults([]);
        }
    };


    const recalcTotals = (mealsList: any[]) => {
        let kcal = 0, carbs = 0, pro = 0, fat = 0;
        mealsList.forEach((m: any) => {
            const base = m.baseQty !== undefined && m.baseQty !== null && m.baseQty > 0
                ? m.baseQty
                : (m.unit === 'porzione' || m.meal === 'quick' ? 1 : 100);
            const qty = m.quantity !== undefined && m.quantity !== null
                ? m.quantity
                : base;
            const ratio = base > 0 ? qty / base : 1;
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
        const addedItem = {
            id: Logic.generateId('meal'),
            foodId: food.id,
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

        try {
            await saveUserData((prev) => {
                if (!prev) return prev;
                const todayData = prev.nutrition?.[targetDateStr] || { date: targetDateStr, kcal: 0, carbs: 0, pro: 0, fat: 0, meals: [] };
                const currentIsDayOn = localDayOnMap[targetDateStr] !== undefined ? localDayOnMap[targetDateStr] : (todayData.isDayOn ?? true);
                const updatedMeals = [...(todayData.meals || []), addedItem];
                const totals = recalcTotals(updatedMeals);
                return { ...prev, nutrition: { ...(prev.nutrition || {}), [targetDateStr]: { ...todayData, meals: updatedMeals, ...totals, isDayOn: currentIsDayOn } } };
            });
            setSearchQuery('');
        } catch {
            showAlert("Errore durante il salvataggio dell'alimento.");
        }
    };

    const clearSearch = () => {
        setSearchQuery('');
        setSearchResults([]);
    };

    const updateMealItem = async (updatedItem: any) => {
        const targetId = updatedItem.itemId || updatedItem.time || updatedItem.id;

        try {
            await saveUserData((prev) => {
                if (!prev) return prev;
                const todayData = prev.nutrition?.[targetDateStr] || { date: targetDateStr, kcal: 0, carbs: 0, pro: 0, fat: 0, meals: [] };
                const updatedMeals = (todayData.meals || []).map((m: any) => {
                    const mId = m.itemId || m.time || m.id;
                    return mId === targetId ? { ...m, ...updatedItem } : m;
                });
                const totals = recalcTotals(updatedMeals);
                return { ...prev, nutrition: { ...(prev.nutrition || {}), [targetDateStr]: { ...todayData, meals: updatedMeals, ...totals } } };
            });
        } catch {
            showAlert("Errore durante l'aggiornamento dell'alimento.");
        }
    };

    const removeFood = async (itemTime: number | string) => {
        try {
            await saveUserData((prev) => {
                if (!prev) return prev;
                const todayData = prev.nutrition?.[targetDateStr] || { date: targetDateStr, kcal: 0, carbs: 0, pro: 0, fat: 0, meals: [] };
                const updatedMeals = (todayData.meals || []).filter((m: any) => (m.itemId || m.time || m.id) !== itemTime);
                const totals = recalcTotals(updatedMeals);
                return { ...prev, nutrition: { ...(prev.nutrition || {}), [targetDateStr]: { ...todayData, meals: updatedMeals, ...totals } } };
            });
        } catch {
            showAlert("Errore durante la rimozione dell'alimento.");
        }
    };

    const handleDeleteItem = async (itemTime: number) => {
        removeFood(itemTime);
    };

    const clearDay = async () => {
        try {
            await saveUserData((prev) => {
                if (!prev) return prev;
                const emptyDay = { date: targetDateStr, kcal: 0, carbs: 0, pro: 0, fat: 0, meals: [] };
                return { ...prev, nutrition: { ...(prev.nutrition || {}), [targetDateStr]: emptyDay } };
            });
        } catch {
            showAlert("Errore durante la pulizia della giornata.");
        }
    };

    const saveCustomFood = async () => {
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

        if (validation.cleanData) {
            const cleanData = validation.cleanData;
            const currentEditingId = editingFoodId;
            try {
                await saveUserData((prev) => {
                    if (!prev) return prev;
                    const foods = (prev.customFoods || []) as any[];
                    const updatedFoods = currentEditingId
                        ? foods.map((f: any) => f.id === currentEditingId ? { ...cleanData, id: currentEditingId } : f)
                        : [...foods, { ...cleanData, id: Logic.generateId('food') }];
                    return { ...prev, customFoods: updatedFoods };
                });
                setShowCustomModal(false);
                setEditingFoodId(null);
                setCfData({ name: '', brand: '', unit: 'g', pieceWeight: '', kcal: '', carbs: '', pro: '', fat: '' });
                await showAlert(currentEditingId ? "Alimento aggiornato con successo!" : "Alimento salvato nei tuoi alimenti!");
            } catch {
                await showAlert("Errore durante il salvataggio dell'alimento.");
            }
        }
    };

    return {
        targetDateStr,
        todayNutrition, dailyTarget, isDayOn, toggleDayType, setDayType,
        searchQuery, setSearchQuery, handleSearch, searchResults, handleDeleteItem, clearSearch,
        clearDay,
        handleQuickAdd,
        showCustomModal, setShowCustomModal,
        editingFoodId, setEditingFoodId, startEditCustomFood, cancelCustomFood,
        cfData, setCfData, saveCustomFood,
        meals, addFood, removeFood, updateMealItem
    };
}
