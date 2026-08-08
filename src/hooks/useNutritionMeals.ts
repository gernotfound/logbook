import { useState } from 'react';
import { useAppStore } from '../store/useAppStore';
import { useDialogStore } from '../store/useDialogStore';
import { Logic } from '../lib/logic';

export function useNutritionMeals() {
    const userData = useAppStore(state => state.userData);
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

    const todayDateStr = Logic.getLocalDateString();
    const todayNutrition = userData?.nutrition?.[todayDateStr] || { 
        date: todayDateStr, kcal: 0, carbs: 0, pro: 0, fat: 0, meals: [] 
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
        if (!userData) return;
        const addedItem = {
            id: Logic.generateId('food'),
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

        try {
            // Usa functional updater: legge sempre lo stato più recente da Zustand,
            // evitando la race condition su doppio tap rapido.
            await saveUserData((prev) => {
                if (!prev) return prev;
                const todayData = prev.nutrition?.[todayDateStr] || { date: todayDateStr, kcal: 0, carbs: 0, pro: 0, fat: 0, meals: [] };
                const updatedMeals = [...(todayData.meals || []), addedItem];
                const totals = recalcTotals(updatedMeals);
                return { ...prev, nutrition: { ...(prev.nutrition || {}), [todayDateStr]: { ...todayData, meals: updatedMeals, ...totals } } };
            });
        } catch {
            showAlert("Errore durante il salvataggio dell'alimento.");
        }
    };

    const handleSearch = (query: string) => {
        setSearchQuery(query);
        if (query.trim().length > 0) {
            const customFoods = (userData?.customFoods || []) as any[];
            const res = Logic.searchFoods(customFoods, query).slice(0, 15);
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
        if (!userData) return;
        const addedItem = {
            id: Logic.generateId('food'),
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
                const todayData = prev.nutrition?.[todayDateStr] || { date: todayDateStr, kcal: 0, carbs: 0, pro: 0, fat: 0, meals: [] };
                const updatedMeals = [...(todayData.meals || []), addedItem];
                const totals = recalcTotals(updatedMeals);
                return { ...prev, nutrition: { ...(prev.nutrition || {}), [todayDateStr]: { ...todayData, meals: updatedMeals, ...totals } } };
            });
            setSearchQuery('');
        } catch {
            showAlert("Errore durante il salvataggio dell'alimento.");
        }
    };

    const clearSearch = () => {
        setSearchQuery('');
    };

    const updateMealItem = async (updatedItem: any) => {
        if (!userData) return;
        const targetId = updatedItem.itemId || updatedItem.time || updatedItem.id;

        try {
            await saveUserData((prev) => {
                if (!prev) return prev;
                const todayData = prev.nutrition?.[todayDateStr] || { date: todayDateStr, kcal: 0, carbs: 0, pro: 0, fat: 0, meals: [] };
                const updatedMeals = (todayData.meals || []).map((m: any) => {
                    const mId = m.itemId || m.time || m.id;
                    return mId === targetId ? { ...m, ...updatedItem } : m;
                });
                const totals = recalcTotals(updatedMeals);
                return { ...prev, nutrition: { ...(prev.nutrition || {}), [todayDateStr]: { ...todayData, meals: updatedMeals, ...totals } } };
            });
        } catch {
            showAlert("Errore durante l'aggiornamento dell'alimento.");
        }
    };

    const removeFood = async (itemTime: number) => {
        if (!userData) return;

        try {
            await saveUserData((prev) => {
                if (!prev) return prev;
                const todayData = prev.nutrition?.[todayDateStr] || { date: todayDateStr, kcal: 0, carbs: 0, pro: 0, fat: 0, meals: [] };
                const updatedMeals = (todayData.meals || []).filter((m: any) => (m.itemId || m.time || m.id) !== itemTime);
                const totals = recalcTotals(updatedMeals);
                return { ...prev, nutrition: { ...(prev.nutrition || {}), [todayDateStr]: { ...todayData, meals: updatedMeals, ...totals } } };
            });
        } catch {
            showAlert("Errore durante la rimozione dell'alimento.");
        }
    };

    const handleDeleteItem = async (itemTime: number) => {
        removeFood(itemTime);
    };

    const clearDay = async () => {
        if (!userData) return;
        try {
            await saveUserData((prev) => {
                if (!prev) return prev;
                const emptyDay = { date: todayDateStr, kcal: 0, carbs: 0, pro: 0, fat: 0, meals: [] };
                return { ...prev, nutrition: { ...(prev.nutrition || {}), [todayDateStr]: emptyDay } };
            });
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

        if (validation.cleanData) {
            const cleanData = validation.cleanData;
            const currentEditingId = editingFoodId;
            try {
                await saveUserData((prev) => {
                    if (!prev) return prev;
                    const foods = (prev.customFoods || []) as any[];
                    const updatedFoods = currentEditingId
                        ? foods.map((f: any) => f.id === currentEditingId ? { ...cleanData, id: currentEditingId } : f)
                        : [...foods, cleanData];
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
        searchQuery, setSearchQuery, handleSearch, searchResults, handleDeleteItem, clearSearch,
        clearDay,
        handleQuickAdd,
        showCustomModal, setShowCustomModal,
        editingFoodId, setEditingFoodId, startEditCustomFood, cancelCustomFood,
        cfData, setCfData, saveCustomFood,
        meals, addFood, removeFood, updateMealItem
    };
}
