import { useState } from 'react';
import { useAppStore } from '../store/useAppStore';
import { useDialogStore } from '../store/useDialogStore';
import { Logic } from '../lib/logic';
import type { LoggedMealItem } from '../types';

const EMPTY_FOODS: any[] = [];
const DEFAULT_NUTRITION = { kcal: 0, carbs: 0, pro: 0, fat: 0, meals: [] };

export function useNutritionMeals(dateStr?: string) {
    const targetDateStr = dateStr || Logic.getLocalDateString();
    const storeNutrition = useAppStore(state => state.userData?.nutrition?.[targetDateStr]);
    const todayNutrition = storeNutrition || { ...DEFAULT_NUTRITION, date: targetDateStr };
    const customFoods = useAppStore(state => state.userData?.customFoods || EMPTY_FOODS);
    const dispatchDomainOperation = useAppStore(state => state.dispatchDomainOperation);
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

    const persistDayType = async (value: boolean) => {
        await dispatchDomainOperation({ type: 'nutrition-day.patch', date: targetDateStr, patch: { isDayOn: value } });
    };

    const toggleDayType = async () => {
        const newIsOn = !isDayOn;
        setLocalDayOnMap(prev => ({ ...prev, [targetDateStr]: newIsOn }));
        if ((todayNutrition.meals && todayNutrition.meals.length > 0) || dbIsDayOn !== undefined || todayNutrition.weight) {
            try { await persistDayType(newIsOn); }
            catch { showAlert("Errore durante il salvataggio."); }
        }
    };

    const setDayType = async (isOn: boolean) => {
        if (isDayOn === isOn) return;
        setLocalDayOnMap(prev => ({ ...prev, [targetDateStr]: isOn }));
        if ((todayNutrition.meals && todayNutrition.meals.length > 0) || dbIsDayOn !== undefined || todayNutrition.weight) {
            try { await persistDayType(isOn); }
            catch { showAlert("Errore durante il salvataggio."); }
        }
    };

    const meals = (todayNutrition.meals || []) as LoggedMealItem[];

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

    const saveMeal = async (meal: LoggedMealItem) => {
        const currentIsDayOn = localDayOnMap[targetDateStr] !== undefined
            ? localDayOnMap[targetDateStr]
            : (todayNutrition.isDayOn ?? true);
        await dispatchDomainOperation([
            { type: 'nutrition-meal.upsert', date: targetDateStr, meal },
            { type: 'nutrition-day.patch', date: targetDateStr, patch: { isDayOn: currentIsDayOn } },
        ]);
    };

    const handleQuickAdd = async (quickData: any) => {
        const addedItem: LoggedMealItem = {
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

        try { await saveMeal(addedItem); }
        catch { showAlert("Errore durante il salvataggio dell'alimento."); }
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

    const addFood = async (food: any, mealType: string) => {
        const addedItem: LoggedMealItem = {
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
            await saveMeal(addedItem);
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
        const current = meals.find((meal: any) => (meal.itemId || meal.time || meal.id) === targetId);
        if (!current?.id) {
            await showAlert("Alimento non trovato o privo di identificativo.");
            return;
        }
        try {
            await dispatchDomainOperation({
                type: 'nutrition-meal.upsert',
                date: targetDateStr,
                meal: { ...current, ...updatedItem, id: current.id },
            });
        } catch {
            showAlert("Errore durante l'aggiornamento dell'alimento.");
        }
    };

    const removeFood = async (itemTime: number | string) => {
        const current = meals.find((meal: any) => (meal.itemId || meal.time || meal.id) === itemTime);
        if (!current?.id) {
            await showAlert("Alimento non trovato o privo di identificativo.");
            return;
        }
        try {
            await dispatchDomainOperation({ type: 'nutrition-meal.delete', date: targetDateStr, mealId: current.id });
        } catch {
            showAlert("Errore durante la rimozione dell'alimento.");
        }
    };

    const handleDeleteItem = async (itemTime: number) => {
        await removeFood(itemTime);
    };

    const clearDay = async () => {
        try {
            await dispatchDomainOperation({ type: 'nutrition-day.delete', date: targetDateStr });
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
            const currentEditingId = editingFoodId;
            const id = currentEditingId ?? Logic.generateId('food');
            try {
                await dispatchDomainOperation({ type: 'food.upsert', food: { ...validation.cleanData, id } as any });
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
