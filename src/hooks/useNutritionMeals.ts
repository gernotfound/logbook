import { useState } from 'react';
import { useAppStore } from '../store/useAppStore';
import { COMMON_FOODS } from '../lib/foods';
import { Logic } from '../lib/logic';

export function useNutritionMeals() {
    const { userData, saveUserData } = useAppStore();
    
    const [searchQuery, setSearchQuery] = useState('');
    const [searchResults, setSearchResults] = useState([]);
    
    const [showCustomModal, setShowCustomModal] = useState(false);
    const [cfData, setCfData] = useState({
        name: '', brand: '', unit: 'g', pieceWeight: '',
        kcal: '', carbs: '', pro: '', fat: ''
    });

    const todayDateStr = new Date().toISOString().split('T')[0];
    const todayNutrition = userData?.nutrition?.[todayDateStr] || { 
        kcal: 0, carbs: 0, pro: 0, fat: 0, meals: [] 
    };
    
    const meals = todayNutrition.meals || [];

    const handleSearch = (query) => {
        setSearchQuery(query);
        if (query.trim().length > 1) {
            const q = query.toLowerCase();
            const customFoods = userData?.customFoods || [];
            const combined = [...COMMON_FOODS, ...customFoods];
            const res = combined.filter(f => 
                (f.name || '').toLowerCase().includes(q) || 
                (f.category || '').toLowerCase().includes(q) ||
                (f.brand || '').toLowerCase().includes(q)
            ).slice(0, 10);
            setSearchResults(res);
        } else {
            setSearchResults([]);
        }
    };

    const recalcTotals = (mealsList) => {
        let kcal = 0, carbs = 0, pro = 0, fat = 0;
        mealsList.forEach(m => {
            const ratio = (m.quantity || m.baseQty || 100) / (m.baseQty || 100);
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

    const addFood = (food, mealType) => {
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
        saveUserData({ ...userData, nutrition: newNutritionObj });
        
        setSearchQuery('');
        setSearchResults([]);
    };

    const removeFood = (itemTime) => {
        const updatedMeals = meals.filter(m => m.time !== itemTime);
        const { kcal, carbs, pro, fat } = recalcTotals(updatedMeals);

        const newNutritionDay = {
            ...todayNutrition,
            meals: updatedMeals,
            kcal, carbs, pro, fat
        };

        const newNutritionObj = { ...(userData.nutrition || {}), [todayDateStr]: newNutritionDay };
        saveUserData({ ...userData, nutrition: newNutritionObj });
    };

    const saveCustomFood = () => {
        const foodData = {
            ...cfData,
            baseQty: 100,
            servingWeight: cfData.unit === 'pezzo' ? cfData.pieceWeight : null
        };
        
        const validation = Logic.validateCustomFood(foodData);
        if (!validation.isValid) {
            alert("Attenzione: errori nei dati dell'alimento:\n" + Object.values(validation.errors).join('\n'));
            return;
        }

        const customFoods = userData?.customFoods || [];
        const updatedCustomFoods = [...customFoods, validation.cleanData];
        saveUserData({ ...userData, customFoods: updatedCustomFoods });
        
        setShowCustomModal(false);
        setCfData({ name: '', brand: '', unit: 'g', pieceWeight: '', kcal: '', carbs: '', pro: '', fat: '' });
        alert("Alimento custom salvato!");
    };

    return {
        searchQuery, setSearchQuery, handleSearch, searchResults,
        showCustomModal, setShowCustomModal,
        cfData, setCfData, saveCustomFood,
        meals, addFood, removeFood
    };
}
