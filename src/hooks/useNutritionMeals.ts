import { useMemo, useState } from 'react';
import { captureSession, isCurrentSession } from '../lib/sync/session';
import { createFoodSearcher } from '../lib/calc/foodSearch';
import { calculateDailyMacroTarget } from '../lib/calc/nutrition';
import { dispatchDurableOperation } from '../lib/sync/dispatchDurableOperation';
import { customFoodDraftFrom, customFoodValidationInput, emptyCustomFoodDraft } from '../lib/nutrition/customFoodDraft';
import { useAppStore } from '../store/useAppStore';
import { useDialogStore } from '../store/useDialogStore';
import { Logic } from '../lib/logic';
import type { Food, LoggedMealItem } from '../types';
import { createLoggedMealItem } from '../lib/nutrition/createLoggedMealItem';

const EMPTY_FOODS: Food[] = [];
const EMPTY_DAILY_TARGET = { kcal: 0, carbs: 0, pro: 0, fat: 0 };
const DEFAULT_NUTRITION = { kcal: 0, carbs: 0, pro: 0, fat: 0, meals: [] };

export function useNutritionMeals(dateStr?: string) {
    const targetDateStr = dateStr || Logic.getLocalDateString();
    const storeNutrition = useAppStore(state => state.userData?.nutrition?.[targetDateStr]);
    const todayNutrition = storeNutrition || { ...DEFAULT_NUTRITION, date: targetDateStr };
    const customFoods = useAppStore(state => state.userData?.customFoods || EMPTY_FOODS);
    const dispatchDomainOperation = useAppStore(state => state.dispatchDomainOperation);
    const showAlert = useDialogStore(state => state.showAlert);
    const persistNutrition = (operation: Parameters<typeof dispatchDomainOperation>[0]) =>
        dispatchDurableOperation(dispatchDomainOperation, operation);

    const [searchQuery, setSearchQuery] = useState('');
    const searchFoods = useMemo(() => createFoodSearcher(customFoods), [customFoods]);
    const searchResults = useMemo(
        () => searchQuery.trim() ? searchFoods(searchQuery, 15) : [],
        [searchFoods, searchQuery]
    );

    const [showCustomModal, setShowCustomModal] = useState(false);
    const [editingFoodId, setEditingFoodId] = useState<string | number | null>(null);
    const [cfData, setCfData] = useState(emptyCustomFoodDraft);

    const planning = useAppStore(state => state.userData?.nutritionPlanning);
    const nutritionMap = useAppStore(state => state.userData?.nutrition);

    // Domain Operations already updates Zustand optimistically and restores the
    // durable snapshot after a failed commit. A second local override would hide
    // subsequent hydration and edits from other tabs or account sessions.
    const isDayOn = todayNutrition.isDayOn;

    // Use the shared parser to handle decimal commas and invalid measurements.
    const latestWeight = useMemo(() => Logic.getLatestUserWeight(nutritionMap), [nutritionMap]);

    const dailyTarget = calculateDailyMacroTarget(planning, isDayOn, latestWeight) ?? EMPTY_DAILY_TARGET;

    const setDayType = async (isOn: boolean | undefined) => {
        if (isDayOn === isOn) return;
        const session = captureSession();
        try { await persistNutrition({ type: 'nutrition-day.patch', date: targetDateStr, patch: { isDayOn: isOn } }); }
        catch { if (isCurrentSession(session)) await showAlert("Errore durante il salvataggio."); }
    };

    const meals: LoggedMealItem[] = todayNutrition.meals || [];

    const startEditCustomFood = (food: Food) => {
        setEditingFoodId(food.id ?? null);
        setCfData(customFoodDraftFrom(food));
        setShowCustomModal(true);
    };

    const cancelCustomFood = () => {
        setShowCustomModal(false);
        setEditingFoodId(null);
        setCfData(emptyCustomFoodDraft());
    };

    const handleSearch = (query: string) => setSearchQuery(query);

    const addFood = async (food: Food, mealType: string) => {
        const session = captureSession();
        try {
            const addedItem = createLoggedMealItem(food, mealType, Logic.generateId('meal'), Date.now());
            await persistNutrition({ type: 'nutrition-meal.upsert', date: targetDateStr, meal: addedItem });
            // The form may survive Auth A→B→A while this device commit awaits an ACK.
            if (isCurrentSession(session)) setSearchQuery('');
        } catch {
            if (isCurrentSession(session)) void showAlert("Errore durante il salvataggio dell'alimento.");
        }
    };

    const clearSearch = () => setSearchQuery('');

    const updateMealItem = async (updatedItem: Pick<LoggedMealItem, 'id' | 'quantity' | 'meal'>): Promise<boolean> => {
        const current = meals.find(meal => meal.id === updatedItem.id);
        if (!current) {
            await showAlert("Alimento non trovato o privo di identificativo.");
            return false;
        }
        const session = captureSession();
        try {
            await persistNutrition({
                type: 'nutrition-meal.upsert',
                date: targetDateStr,
                meal: { ...current, ...updatedItem, id: current.id },
            });
            return isCurrentSession(session);
        } catch {
            if (isCurrentSession(session)) await showAlert("Errore durante l'aggiornamento dell'alimento.");
            return false;
        }
    };

    const removeFood = async (mealId: string): Promise<boolean> => {
        const current = meals.find(meal => meal.id === mealId);
        if (!current) {
            await showAlert("Alimento non trovato o privo di identificativo.");
            return false;
        }
        const session = captureSession();
        try {
            await persistNutrition({ type: 'nutrition-meal.delete', date: targetDateStr, mealId: current.id });
            return isCurrentSession(session);
        } catch {
            if (isCurrentSession(session)) await showAlert("Errore durante la rimozione dell'alimento.");
            return false;
        }
    };

    const clearDay = async () => {
        const session = captureSession();
        try {
            await persistNutrition({ type: 'nutrition-day.delete', date: targetDateStr });
        } catch {
            if (isCurrentSession(session)) void showAlert("Errore durante la pulizia della giornata.");
        }
    };

    const saveCustomFood = async (): Promise<boolean> => {
        const validation = Logic.validateCustomFood(customFoodValidationInput(cfData));
        if (!validation.isValid) {
            await showAlert("Attenzione: errori nei dati dell'alimento:\n" + Object.values(validation.errors).join('\n'));
            return false;
        }

        if (validation.cleanData) {
            const session = captureSession();
            const currentEditingId = editingFoodId;
            const id = currentEditingId ?? Logic.generateId('food');
            try {
                await persistNutrition({ type: 'food.upsert', food: { ...validation.cleanData, id } });
                if (!isCurrentSession(session)) return false;
                setShowCustomModal(false);
                setEditingFoodId(null);
                setCfData(emptyCustomFoodDraft());
                return true;
            } catch {
                if (isCurrentSession(session)) await showAlert("Errore durante il salvataggio dell'alimento.");
            }
        }
        return false;
    };

    return {
        targetDateStr,
        todayNutrition, dailyTarget, isDayOn, setDayType,
        searchQuery, setSearchQuery, handleSearch, searchResults, clearSearch,
        clearDay,
        showCustomModal, setShowCustomModal,
        editingFoodId, setEditingFoodId, startEditCustomFood, cancelCustomFood,
        cfData, setCfData, saveCustomFood,
        meals, addFood, removeFood, updateMealItem
    };
}
