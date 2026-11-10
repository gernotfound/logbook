import { dispatchDurableOperation } from '../../lib/sync/dispatchDurableOperation';
import { captureSession, isCurrentSession } from '../../lib/sync/session';
import { useState, useMemo } from 'react';
import { Plus, Search, Utensils } from 'lucide-react';
import { useAppStore } from '../../store/useAppStore';
import { useDialogStore } from '../../store/useDialogStore';
import { Logic } from '../../lib/logic';
import { createFoodSearcher } from '../../lib/calc/nutrition';
import CustomFoodForm from './CustomFoodForm';
import { FoodArchiveSearch } from './archive/FoodArchiveSearch';
import { createLoggedMealItem } from '../../lib/nutrition/createLoggedMealItem';
import { FoodItemRow } from './archive/FoodItemRow';

const MEAL_TYPES = ['Colazione', 'Pranzo', 'Cena', 'Spuntini'];
const EMPTY_FOODS: any[] = [];
const ARCHIVE_PAGE_SIZE = 50;

interface NutritionFoodArchiveProps {
    onEditFood?: (food: any) => void;
}

export default function NutritionFoodArchive({ onEditFood }: NutritionFoodArchiveProps) {
    const customFoods = useAppStore(state => state.userData?.customFoods || EMPTY_FOODS);
    const dispatchDomainOperation = useAppStore(state => state.dispatchDomainOperation);
    const showAlert = useDialogStore(state => state.showAlert);
    const showConfirm = useDialogStore(state => state.showConfirm);

    const [searchQuery, setSearchQuery] = useState('');
    const [page, setPage] = useState(() => ({ query: '', source: customFoods, count: ARCHIVE_PAGE_SIZE }));
    const updateSearchQuery = (value: string) => {
        setSearchQuery(value);
        setPage({ query: value, source: customFoods, count: ARCHIVE_PAGE_SIZE });
    };

    // Modal states (used if onEditFood not provided)
    const [showModal, setShowModal] = useState(false);
    const [editingFoodId, setEditingFoodId] = useState<string | number | null>(null);
    const [cfData, setCfData] = useState({
        name: '', brand: '', unit: 'g', pieceWeight: '',
        kcal: '', carbs: '', pro: '', fat: ''
    });

    const searchFoods = useMemo(() => createFoodSearcher(customFoods), [customFoods]);
    const filteredFoods = useMemo(() => searchFoods(searchQuery), [searchFoods, searchQuery]);
    const visibleCount = page.query === searchQuery && page.source === customFoods ? page.count : ARCHIVE_PAGE_SIZE;
    const visibleFoods = filteredFoods.slice(0, visibleCount);

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
            pieceWeight: food.servingWeight ?? '',
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
            const id = currentEditingId ?? Logic.generateId('food');
            await dispatchDurableOperation(dispatchDomainOperation, { type: 'food.upsert', food: { ...cleanData, id } as any });
            setShowModal(false);
            setEditingFoodId(null);
        } catch {
            await showAlert("Errore durante il salvataggio dell'alimento.");
        }
    };

    const handleDuplicateFood = async (food: any) => {
        const newName = Logic.generateUniqueName(food.name, customFoods.map(f => f.name));
        const duplicated = {
            ...food,
            id: Logic.generateId('cf'),
            name: newName
        };
        try {
            await dispatchDurableOperation(dispatchDomainOperation, { type: 'food.upsert', food: duplicated });
        } catch {
            await showAlert('Errore durante la duplicazione.');
        }
    };

    const handleDeleteFood = async (food: any) => {
        // The confirmation belongs to the session that opened it, not to any
        // new owner or consent generation that may become active meanwhile.
        let session: ReturnType<typeof captureSession>;
        try {
            session = captureSession();
        } catch {
            return;
        }
        const confirmed = await showConfirm(`Sei sicuro di voler eliminare l'alimento "${food.name}"?`);
        if (!confirmed || !isCurrentSession(session)) return;

        try {
            await dispatchDurableOperation(dispatchDomainOperation, { type: 'food.delete', id: food.id });
        } catch {
            if (isCurrentSession(session)) await showAlert("Errore durante l'eliminazione dell'alimento.");
        }
    };

    const handleQuickAddToMeal = async (food: any, mealType: string) => {
        const todayDateStr = Logic.getLocalDateString();

        try {
            const addedItem = createLoggedMealItem(food, mealType, Logic.generateId('meal'), Date.now());
            await dispatchDurableOperation(dispatchDomainOperation, { type: 'nutrition-meal.upsert', date: todayDateStr, meal: addedItem });
        } catch {
            await showAlert("Errore durante l'aggiunta dell'alimento.");
        }
    };

    return (
        <div>
            {/* Header & Create Button */}
            <div className="section-divider">
                <div className="flex-between mb-15 items-center">
                    <div>
                        <h1 className="m-0" style={{color: 'var(--text-main)'}}>🥗 Alimenti</h1>
                        <p className="text-muted text-base m-0 mt-4">
                            Gestisci, crea e consulta i tuoi alimenti personalizzati
                        </p>
                    </div>
                    {!showModal && (
                        <button 
                            type="button" 
                            className="btn btn-primary btn-small"
                            onClick={openCreateModal}
                            style={{ marginBottom: 0, display: 'flex', alignItems: 'center', gap: '6px' }}
                        >
                            <Plus size={16} aria-hidden="true" /> Crea alimento
                        </button>
                    )}
                </div>

                {/* Modal for create/edit */}
                <CustomFoodForm 
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
                    setSearchQuery={updateSearchQuery}
                />
            </div>

            {/* Food Items List */}
            <div className="section-divider-last">
                <div className="flex-between mb-10 pb-10 border-b">
                    <span className="text-sm font-bold text-muted">
                        I tuoi alimenti ({filteredFoods.length})
                    </span>
                </div>

                {customFoods.length === 0 ? (
                    <div style={{ textAlign: 'center', padding: '30px 10px', color: 'var(--text-muted)' }}>
                        <Utensils size={32} aria-hidden="true" style={{ marginBottom: '8px' }} />
                        <p className="m-0 text-sm font-semibold text-white">Nessun alimento presente.</p>
                        <p className="m-0 text-xs text-muted mt-4">
                            Clicca su <strong>+ Crea alimento</strong> in alto per iniziare a inserire i tuoi alimenti.
                        </p>
                    </div>
                ) : filteredFoods.length === 0 ? (
                    <div style={{ textAlign: 'center', padding: '30px 10px', color: 'var(--text-muted)' }}>
                        <Search size={32} aria-hidden="true" style={{ marginBottom: '8px' }} />
                        <p className="m-0 text-sm">Nessun alimento trovato per "{searchQuery}".</p>
                    </div>
                ) : (
                    <>
                    {visibleFoods.map((f: any, idx: number) => (
                        <FoodItemRow
                            key={f.id || idx}
                            food={f}
                            isLast={idx === visibleFoods.length - 1}
                            mealTypes={MEAL_TYPES}
                            onEdit={openEditModal}
                            onDelete={handleDeleteFood}
                                onDuplicate={handleDuplicateFood}
                            onQuickAddToMeal={handleQuickAddToMeal}
                        />
                    ))}
                    {visibleFoods.length < filteredFoods.length && (
                        <button
                            type="button"
                            className="btn btn-secondary"
                            onClick={() => setPage({ query: searchQuery, source: customFoods, count: visibleCount + ARCHIVE_PAGE_SIZE })}
                            aria-label={`Mostra altri alimenti (${filteredFoods.length - visibleFoods.length} rimanenti)`}
                        >
                            Mostra altri alimenti
                        </button>
                    )}
                    </>
                )}
            </div>
        </div>
    );
}
