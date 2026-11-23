import { useMemo, useState } from 'react';
import { createFoodSearcher } from '../lib/calc/foodSearch';
import { calculateDailyMacroTarget } from '../lib/calc/nutrition';
import { customFoodDraftFrom, customFoodValidationInput, emptyCustomFoodDraft } from '../lib/nutrition/customFoodDraft';
import type { DomainOperation } from '../lib/sync/domainOperations';
import { Logic } from '../lib/logic';
import type { Food, LoggedMealItem, NutritionDay, UserData } from '../types';
import { createLoggedMealItem } from '../lib/nutrition/createLoggedMealItem';

const EMPTY_FOODS: Food[] = [];
const EMPTY_DAILY_TARGET = { kcal: 0, carbs: 0, pro: 0, fat: 0 };
const DEFAULT_NUTRITION = { kcal: 0, carbs: 0, pro: 0, fat: 0, meals: [] };

export type CaptureNutritionSession = () => { isCurrent: () => boolean } | null;

export function useNutritionMealEditor(targetDateStr: string, source: {
    day: NutritionDay | undefined;
    customFoods: Food[] | undefined;
    planning: UserData['nutritionPlanning'];
    nutrition: UserData['nutrition'];
    capture: CaptureNutritionSession;
    dispatch: (operation: DomainOperation) => Promise<void>;
}, showAlert: (message: string) => Promise<unknown>) {
    const todayNutrition = source.day ?? { ...DEFAULT_NUTRITION, date: targetDateStr };
    const customFoods = source.customFoods ?? EMPTY_FOODS;
    const { capture, dispatch: persistNutrition } = source;

    const [searchQuery, setSearchQuery] = useState('');
    const searchFoods = useMemo(() => createFoodSearcher(customFoods), [customFoods]);
    const searchResults = useMemo(
        () => searchQuery.trim() ? searchFoods(searchQuery, 15) : [],
        [searchFoods, searchQuery]
    );

    const [showCustomModal, setShowCustomModal] = useState(false);
    const [editingFoodId, setEditingFoodId] = useState<string | number | null>(null);
    const [cfData, setCfData] = useState(emptyCustomFoodDraft);

    const isDayOn = todayNutrition.isDayOn;

    // Use the shared parser to handle decimal commas and invalid measurements.
    const latestWeight = useMemo(() => Logic.getLatestUserWeight(source.nutrition), [source.nutrition]);

    const dailyTarget = calculateDailyMacroTarget(source.planning, isDayOn, latestWeight) ?? EMPTY_DAILY_TARGET;

    const setDayType = async (isOn: boolean | undefined) => {
        if (isDayOn === isOn) return;
        const session = capture();
        if (!session?.isCurrent()) return;
        try { await persistNutrition({ type: 'nutrition-day.patch', date: targetDateStr, patch: { isDayOn: isOn } }); }
        catch { if (session.isCurrent()) await showAlert("Errore durante il salvataggio."); }
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
        const session = capture();
        if (!session?.isCurrent()) return;
        try {
            const addedItem = createLoggedMealItem(food, mealType, Logic.generateId('meal'), Date.now());
            await persistNutrition({ type: 'nutrition-meal.upsert', date: targetDateStr, meal: addedItem });
            // The form may survive Auth A→B→A while this device commit awaits an ACK.
            if (session.isCurrent()) setSearchQuery('');
        } catch {
            if (session.isCurrent()) void showAlert("Errore durante il salvataggio dell'alimento.");
        }
    };

    const clearSearch = () => setSearchQuery('');

    const updateMealItem = async (updatedItem: Pick<LoggedMealItem, 'id'>
        & Partial<Pick<LoggedMealItem, 'quantity' | 'meal'>>): Promise<boolean> => {
        const session = capture();
        if (!session?.isCurrent()) return false;
        const current = meals.find(meal => meal.id === updatedItem.id);
        if (!current) {
            await showAlert("Alimento non trovato o privo di identificativo.");
            return false;
        }
        try {
            await persistNutrition({
                type: 'nutrition-meal.edit',
                date: targetDateStr,
                mealId: current.id,
                quantity: updatedItem.quantity,
                meal: updatedItem.meal,
            });
            return session.isCurrent();
        } catch {
            if (session.isCurrent()) await showAlert("Errore durante l'aggiornamento dell'alimento.");
            return false;
        }
    };

    const removeFood = async (mealId: string): Promise<boolean> => {
        const session = capture();
        if (!session?.isCurrent()) return false;
        const current = meals.find(meal => meal.id === mealId);
        if (!current) {
            await showAlert("Alimento non trovato o privo di identificativo.");
            return false;
        }
        try {
            await persistNutrition({ type: 'nutrition-meal.delete', date: targetDateStr, mealId: current.id });
            return session.isCurrent();
        } catch {
            if (session.isCurrent()) await showAlert("Errore durante la rimozione dell'alimento.");
            return false;
        }
    };

    const clearDay = async () => {
        const session = capture();
        if (!session?.isCurrent()) return;
        try {
            await persistNutrition({ type: 'nutrition-day.delete', date: targetDateStr });
        } catch {
            if (session.isCurrent()) void showAlert("Errore durante la pulizia della giornata.");
        }
    };

    const saveCustomFood = async (): Promise<boolean> => {
        const session = capture();
        if (!session?.isCurrent()) return false;
        const validation = Logic.validateCustomFood(customFoodValidationInput(cfData));
        if (!validation.isValid) {
            await showAlert("Attenzione: errori nei dati dell'alimento:\n" + Object.values(validation.errors).join('\n'));
            return false;
        }

        if (validation.cleanData) {
            const currentEditingId = editingFoodId;
            const id = currentEditingId ?? Logic.generateId('food');
            try {
                await persistNutrition({
                    type: currentEditingId === null ? 'food.upsert' : 'food.edit',
                    food: { ...validation.cleanData, id },
                });
                if (!session.isCurrent()) return false;
                setShowCustomModal(false);
                setEditingFoodId(null);
                setCfData(emptyCustomFoodDraft());
                return true;
            } catch {
                if (session.isCurrent()) await showAlert("Errore durante il salvataggio dell'alimento.");
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
