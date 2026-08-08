import { useState, useMemo } from 'react';
import { useAppStore } from '../../store/useAppStore';
import { useDialogStore } from '../../store/useDialogStore';
import { Logic } from '../../lib/logic';
import CustomFoodModal from './CustomFoodModal';
import { FoodArchiveSearch } from './archive/FoodArchiveSearch';
import { FoodItemRow } from './archive/FoodItemRow';

const MEAL_TYPES = ['Colazione', 'Pranzo', 'Cena', 'Spuntini'];
const EMPTY_FOODS: any[] = [];

interface NutritionFoodArchiveProps {
    onEditFood?: (food: any) => void;
}

export default function NutritionFoodArchive({ onEditFood }: NutritionFoodArchiveProps) {
    const customFoods = useAppStore(state => state.userData?.customFoods || EMPTY_FOODS);
    const saveUserData = useAppStore(state => state.saveUserData);
    const showAlert = useDialogStore(state => state.showAlert);
    const showConfirm = useDialogStore(state => state.showConfirm);

    const [searchQuery, setSearchQuery] = useState('');
    
    // Modal states (used if onEditFood not provided)
    const [showModal, setShowModal] = useState(false);
    const [editingFoodId, setEditingFoodId] = useState<string | number | null>(null);
    const [cfData, setCfData] = useState({
        name: '', brand: '', unit: 'g', pieceWeight: '',
        kcal: '', carbs: '', pro: '', fat: ''
    });

    const filteredFoods = useMemo(() => {
        return Logic.searchFoods(customFoods, searchQuery);
    }, [customFoods, searchQuery]);

    const openCreateModal = () => {
        setEditingFoodId(null);
        setCfData({
            name: '', brand: '', unit: 'g', pieceWeight: '',
            kcal: '', carbs: '', pro: '', fat: ''
        });
        setShowModal(true);
    };

    const openEditModal = (food: any) => {
        if (onEditFood) {
            onEditFood(food);
            return;
        }
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
        setShowModal(true);
    };

    const handleSaveFood = async () => {
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

        if (!validation.cleanData) return;

        const currentEditingId = editingFoodId;
        const cleanData = validation.cleanData;

        try {
            await saveUserData((prev) => {
                if (!prev) return prev;
                const existing = (prev.customFoods || []) as any[];
                const updatedCustomFoods = currentEditingId
                    ? existing.map(f => f.id === currentEditingId ? { ...cleanData, id: currentEditingId } : f)
                    : [...existing, cleanData];
                return { ...prev, customFoods: updatedCustomFoods };
            });
            setShowModal(false);
            setEditingFoodId(null);
            await showAlert(currentEditingId ? "Alimento aggiornato con successo!" : "Alimento creato e salvato!");
        } catch {
            await showAlert("Errore durante il salvataggio dell'alimento.");
        }
    };

    const handleDeleteFood = async (food: any) => {
        const confirmed = await showConfirm(`Sei sicuro di voler eliminare l'alimento "${food.name}"?`);
        if (!confirmed) return;

        try {
            await saveUserData((prev) => {
                if (!prev) return prev;
                const existing = (prev.customFoods || []) as any[];
                return { ...prev, customFoods: existing.filter(f => f.id !== food.id) };
            });
            await showAlert("Alimento eliminato con successo.");
        } catch {
            await showAlert("Errore durante l'eliminazione dell'alimento.");
        }
    };

    const handleQuickAddToMeal = async (food: any, mealType: string) => {
        const todayDateStr = Logic.getLocalDateString();

        const addedItem = {
            id: food.id || Date.now(),
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
                const todayNutrition = prev.nutrition?.[todayDateStr] || { 
                    date: todayDateStr, kcal: 0, carbs: 0, pro: 0, fat: 0, meals: [] 
                };
                const mealsList = (todayNutrition.meals || []) as any[];
                const updatedMeals = [...mealsList, addedItem];

                let totalKcal = 0, totalCarbs = 0, totalPro = 0, totalFat = 0;
                updatedMeals.forEach((m: any) => {
                    const qty = m.quantity ?? m.baseQty ?? 100;
                    const base = m.baseQty ?? 100;
                    const ratio = base > 0 ? qty / base : 1;
                    totalKcal += (parseFloat(m.kcal) || 0) * ratio;
                    totalCarbs += (parseFloat(m.carbs) || 0) * ratio;
                    totalPro += (parseFloat(m.pro) || 0) * ratio;
                    totalFat += (parseFloat(m.fat) || 0) * ratio;
                });

                const newNutritionDay = {
                    ...todayNutrition,
                    meals: updatedMeals,
                    kcal: Math.round(totalKcal),
                    carbs: Math.round(totalCarbs * 10) / 10,
                    pro: Math.round(totalPro * 10) / 10,
                    fat: Math.round(totalFat * 10) / 10
                };

                return {
                    ...prev,
                    nutrition: {
                        ...(prev.nutrition || {}),
                        [todayDateStr]: newNutritionDay
                    }
                };
            });
            await showAlert(`"${food.name}" aggiunto a ${mealType}!`);
        } catch {
            await showAlert("Errore durante l'aggiunta dell'alimento.");
        }
    };

    return (
        <div>
            {/* Header & Create Button */}
            <div className="card mb-15">
                <div className="flex-between mb-15 items-center">
                    <div>
                        <h3 className="m-0" style={{ color: 'var(--primary-color)' }}>🥗 Alimenti</h3>
                        <p className="text-muted text-xs m-0 mt-4">
                            Gestisci, crea e consulta i tuoi alimenti personalizzati
                        </p>
                    </div>
                    <button 
                        type="button" 
                        className="btn btn-primary btn-small"
                        onClick={openCreateModal}
                        style={{ marginBottom: 0 }}
                    >
                        ➕ Crea alimento
                    </button>
                </div>

                {/* Modal for create/edit */}
                <CustomFoodModal 
                    cfData={cfData}
                    setCfData={setCfData}
                    saveCustomFood={handleSaveFood}
                    showCustomModal={showModal}
                    setShowCustomModal={setShowModal}
                    isEditing={!!editingFoodId}
                    onCancel={() => {
                        setShowModal(false);
                        setEditingFoodId(null);
                    }}
                />

                {/* Search Bar */}
                <FoodArchiveSearch 
                    searchQuery={searchQuery}
                    setSearchQuery={setSearchQuery}
                />
            </div>

            {/* Food Items List */}
            <div className="card">
                <div className="flex-between mb-10 pb-10 border-b">
                    <span className="text-sm font-bold text-muted">
                        I tuoi alimenti ({filteredFoods.length})
                    </span>
                </div>

                {customFoods.length === 0 ? (
                    <div style={{ textAlign: 'center', padding: '30px 10px', color: 'var(--text-muted)' }}>
                        <div style={{ fontSize: '2rem', marginBottom: '8px' }}>🥗</div>
                        <p className="m-0 text-sm font-semibold text-white">Nessun alimento presente.</p>
                        <p className="m-0 text-xs text-muted mt-4">
                            Clicca su <strong>+ Crea alimento</strong> in alto per iniziare a inserire i tuoi alimenti.
                        </p>
                    </div>
                ) : filteredFoods.length === 0 ? (
                    <div style={{ textAlign: 'center', padding: '30px 10px', color: 'var(--text-muted)' }}>
                        <div style={{ fontSize: '2rem', marginBottom: '8px' }}>🔍</div>
                        <p className="m-0 text-sm">Nessun alimento trovato per "{searchQuery}".</p>
                    </div>
                ) : (
                    filteredFoods.map((f: any, idx: number) => (
                        <FoodItemRow
                            key={f.id || idx}
                            food={f}
                            isLast={idx === filteredFoods.length - 1}
                            mealTypes={MEAL_TYPES}
                            onEdit={openEditModal}
                            onDelete={handleDeleteFood}
                            onQuickAddToMeal={handleQuickAddToMeal}
                        />
                    ))
                )}
            </div>
        </div>
    );
}
