import { useMemo, useState } from 'react';
import { createFoodSearcher } from '../lib/calc/foodSearch';
import { validateCustomFood } from '../lib/calc/nutrition';
import { createLoggedMealItem } from '../lib/nutrition/createLoggedMealItem';
import { customFoodDraftFrom, customFoodValidationInput, emptyCustomFoodDraft } from '../lib/nutrition/customFoodDraft';
import type { DomainOperation } from '../lib/sync/domainOperations';
import { generateId, getLocalDateString } from '../lib/utils/date';
import { generateUniqueName } from '../lib/utils/string';
import { useDialogStore } from '../store/useDialogStore';
import type { Food } from '../types';
import type { CaptureNutritionSession } from './useNutritionMealEditor';

const PAGE_SIZE = 50;
const EMPTY_FOODS: Food[] = [];

function editableFoodId(id: Food['id']) {
    if (typeof id === 'number') return Number.isFinite(id) ? id : null;
    return typeof id === 'string' && id.trim() ? id : null;
}

export function useNutritionFoodArchive({
    foods, capture, dispatch, onEditFood,
}: {
    foods?: Food[];
    capture: CaptureNutritionSession;
    dispatch: (operation: DomainOperation) => Promise<void>;
    onEditFood?: (food: Food) => void;
}) {
    const customFoods = foods ?? EMPTY_FOODS;
    const showAlert = useDialogStore(state => state.showAlert);
    const showConfirm = useDialogStore(state => state.showConfirm);
    const [searchQuery, setSearchQuery] = useState('');
    const [page, setPage] = useState(() => ({ query: '', source: customFoods, count: PAGE_SIZE }));
    const [showModal, setShowModal] = useState(false);
    const [editingFoodId, setEditingFoodId] = useState<string | number | null>(null);
    const [cfData, setCfData] = useState(emptyCustomFoodDraft);
    const searchFoods = useMemo(() => createFoodSearcher(customFoods), [customFoods]);
    const filteredFoods = useMemo(() => searchFoods(searchQuery), [searchFoods, searchQuery]);
    const visibleCount = page.query === searchQuery && page.source === customFoods ? page.count : PAGE_SIZE;
    const visibleFoods = filteredFoods.slice(0, visibleCount);

    const openCreateModal = () => {
        setEditingFoodId(null);
        setCfData(emptyCustomFoodDraft());
        setShowModal(true);
    };
    const openEditModal = (food: Food) => {
        const id = editableFoodId(food.id);
        if (id === null) {
            void showAlert('Impossibile modificare un alimento senza identificativo valido.');
            return;
        }
        if (onEditFood) {
            onEditFood(food);
            return;
        }
        setEditingFoodId(id);
        setCfData(customFoodDraftFrom(food));
        setShowModal(true);
    };
    const closeModal = () => {
        setShowModal(false);
        setEditingFoodId(null);
    };
    const handleSaveFood = async () => {
        const session = capture();
        if (!session?.isCurrent()) return;
        const validation = validateCustomFood(customFoodValidationInput(cfData));
        if (!validation.isValid) {
            await showAlert("Attenzione: errori nei dati dell'alimento:\n" + Object.values(validation.errors).join('\n'));
            return;
        }
        if (!validation.cleanData) return;
        try {
            const id = editingFoodId ?? generateId('food');
            await dispatch({ type: editingFoodId === null ? 'food.upsert' : 'food.edit', food: { ...validation.cleanData, id } });
            if (session.isCurrent()) closeModal();
        } catch {
            if (session.isCurrent()) await showAlert("Errore durante il salvataggio dell'alimento.");
        }
    };
    const handleDuplicateFood = async (food: Food) => {
        const session = capture();
        if (!session?.isCurrent()) return;
        const name = generateUniqueName(food.name, customFoods.map(item => item.name));
        try {
            await dispatch({ type: 'food.upsert', food: { ...food, id: generateId('cf'), name } });
        } catch {
            if (session.isCurrent()) await showAlert('Errore durante la duplicazione.');
        }
    };
    const handleDeleteFood = async (food: Food) => {
        const session = capture();
        if (!session?.isCurrent()) return;
        const id = editableFoodId(food.id);
        if (id === null) {
            await showAlert('Impossibile eliminare un alimento senza identificativo valido.');
            return;
        }
        // The global dialog can outlive the owner that opened it.
        const confirmed = await showConfirm("Eliminare questo alimento dall'archivio?");
        if (!confirmed || !session.isCurrent()) return;
        try {
            await dispatch({ type: 'food.delete', id });
        } catch {
            if (session.isCurrent()) await showAlert("Errore durante l'eliminazione dell'alimento.");
        }
    };
    const handleQuickAddToMeal = async (food: Food, mealType: string) => {
        const session = capture();
        if (!session?.isCurrent()) return;
        const date = getLocalDateString();
        try {
            const meal = createLoggedMealItem(food, mealType, generateId('meal'), Date.now());
            await dispatch({ type: 'nutrition-meal.upsert', date, meal });
        } catch {
            if (session.isCurrent()) await showAlert("Errore durante l'aggiunta dell'alimento.");
        }
    };
    return {
        customFoods, filteredFoods, visibleFoods, searchQuery, showModal, editingFoodId, cfData, setCfData, setShowModal,
        openCreateModal, openEditModal, closeModal, handleSaveFood, handleDuplicateFood, handleDeleteFood, handleQuickAddToMeal,
        updateSearchQuery(value: string) {
            setSearchQuery(value);
            setPage({ query: value, source: customFoods, count: PAGE_SIZE });
        },
        showMore() {
            setPage({ query: searchQuery, source: customFoods, count: visibleCount + PAGE_SIZE });
        },
    };
}
