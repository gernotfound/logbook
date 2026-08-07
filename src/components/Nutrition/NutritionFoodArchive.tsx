import { useState } from 'react';
import { useAppStore } from '../../store/useAppStore';
import { useDialogStore } from '../../store/useDialogStore';
import { Logic } from '../../lib/logic';
import CustomFoodModal from './CustomFoodModal';

const MEAL_TYPES = ['Colazione', 'Pranzo', 'Cena', 'Spuntini'];

interface NutritionFoodArchiveProps {
    onEditFood?: (food: any) => void;
}

export default function NutritionFoodArchive({ onEditFood }: NutritionFoodArchiveProps) {
    const userData = useAppStore(state => state.userData);
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

    const customFoods = (userData?.customFoods || []) as any[];

    const filteredFoods = customFoods.filter(f => {
        if (!searchQuery.trim()) return true;
        const q = searchQuery.toLowerCase();
        return (
            (f.name || '').toLowerCase().includes(q) ||
            (f.brand || '').toLowerCase().includes(q) ||
            (f.category || '').toLowerCase().includes(q)
        );
    });

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

        if (!validation.cleanData) return;

        let updatedCustomFoods: any[];
        if (editingFoodId) {
            updatedCustomFoods = customFoods.map(f => 
                f.id === editingFoodId ? { ...validation.cleanData, id: editingFoodId } : f
            );
        } else {
            updatedCustomFoods = [...customFoods, validation.cleanData];
        }

        try {
            await saveUserData({ ...userData, customFoods: updatedCustomFoods });
            setShowModal(false);
            setEditingFoodId(null);
            await showAlert(editingFoodId ? "Alimento aggiornato con successo!" : "Alimento creato e salvato!");
        } catch {
            await showAlert("Errore durante il salvataggio dell'alimento.");
        }
    };

    const handleDeleteFood = async (food: any) => {
        if (!userData) return;
        const confirmed = await showConfirm(`Sei sicuro di voler eliminare l'alimento "${food.name}"?`);
        if (!confirmed) return;

        const updatedCustomFoods = customFoods.filter(f => f.id !== food.id);
        try {
            await saveUserData({ ...userData, customFoods: updatedCustomFoods });
            await showAlert("Alimento eliminato con successo.");
        } catch {
            await showAlert("Errore durante l'eliminazione dell'alimento.");
        }
    };

    const handleQuickAddToMeal = async (food: any, mealType: string) => {
        if (!userData) return;
        const todayDateStr = Logic.getLocalDateString();
        const todayNutrition = userData?.nutrition?.[todayDateStr] || { 
            date: todayDateStr, kcal: 0, carbs: 0, pro: 0, fat: 0, meals: [] 
        };
        const mealsList = (todayNutrition.meals || []) as any[];

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

        const newNutritionObj = { ...(userData.nutrition || {}), [todayDateStr]: newNutritionDay };
        try {
            await saveUserData({ ...userData, nutrition: newNutritionObj });
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
                <div style={{ position: 'relative', display: 'flex', alignItems: 'center', marginTop: '10px' }}>
                    <input 
                        type="text" 
                        placeholder="Cerca per nome o marca..." 
                        value={searchQuery}
                        onChange={e => setSearchQuery(e.target.value)}
                        onFocus={e => e.target.select()}
                        style={{ 
                            width: '100%', 
                            margin: 0, 
                            height: '44px', 
                            paddingLeft: '14px', 
                            paddingRight: searchQuery ? '36px' : '14px',
                            fontSize: '16px',
                            borderRadius: '10px'
                        }}
                    />
                    {searchQuery && (
                        <button
                            type="button"
                            onClick={() => setSearchQuery('')}
                            style={{
                                position: 'absolute',
                                right: '8px',
                                background: 'transparent',
                                border: 'none',
                                color: 'var(--text-muted)',
                                fontSize: '1rem',
                                cursor: 'pointer',
                                padding: '4px',
                                display: 'flex',
                                alignItems: 'center',
                                justifyContent: 'center'
                            }}
                            aria-label="Cancella ricerca"
                        >
                            ✕
                        </button>
                    )}
                </div>
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
                        <div 
                            key={f.id || idx}
                            style={{
                                padding: '14px 0',
                                borderBottom: idx === filteredFoods.length - 1 ? 'none' : '1px solid var(--glass-border)',
                                display: 'flex',
                                flexDirection: 'column',
                                gap: '8px'
                            }}
                        >
                            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: '10px' }}>
                                <div>
                                    <div style={{ fontWeight: 'bold', fontSize: '1rem', color: 'var(--text-main)', display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap' }}>
                                        <span>{f.name}</span>
                                    </div>
                                    {f.brand && (
                                        <div style={{ fontSize: '0.8rem', color: 'var(--text-muted)', marginTop: '2px' }}>
                                            {f.brand}
                                        </div>
                                    )}
                                </div>

                                <div style={{ display: 'flex', gap: '6px', flexShrink: 0 }}>
                                    <button 
                                        type="button" 
                                        className="btn btn-small" 
                                        style={{ padding: '4px 8px', fontSize: '0.8rem', background: 'rgba(255,255,255,0.08)', marginBottom: 0 }}
                                        onClick={() => openEditModal(f)}
                                        title="Modifica alimento"
                                    >
                                        ✏️ Modifica
                                    </button>
                                    <button 
                                        type="button" 
                                        className="btn-icon" 
                                        style={{ color: 'var(--danger-color)', fontSize: '0.9rem' }}
                                        onClick={() => handleDeleteFood(f)}
                                        title="Elimina alimento"
                                    >
                                        🗑️
                                    </button>
                                </div>
                            </div>

                            {/* Macro details */}
                            <div style={{ display: 'flex', alignItems: 'center', gap: '12px', fontSize: '0.85rem', color: 'var(--text-muted)', flexWrap: 'wrap' }}>
                                <span style={{ fontWeight: 'bold', color: 'var(--warning-color)' }}>
                                    {f.kcal} kcal
                                </span>
                                <span>/ {f.baseQty || 100}{f.unit || 'g'}</span>
                                <span>•</span>
                                <span>Carbo: <b style={{ color: 'var(--text-main)' }}>{f.carbs || 0}g</b></span>
                                <span>Pro: <b style={{ color: 'var(--text-main)' }}>{f.pro || 0}g</b></span>
                                <span>Grassi: <b style={{ color: 'var(--text-main)' }}>{f.fat || 0}g</b></span>
                            </div>

                            {/* Quick Add buttons */}
                            <div style={{ display: 'flex', alignItems: 'center', gap: '6px', marginTop: '4px' }}>
                                <span style={{ fontSize: '0.75rem', color: 'var(--text-muted)', marginRight: '4px' }}>+ Aggiungi a:</span>
                                {MEAL_TYPES.map(mt => (
                                    <button 
                                        key={mt}
                                        type="button"
                                        className="btn btn-small"
                                        style={{ 
                                            padding: '4px 8px', 
                                            fontSize: '0.75rem', 
                                            marginBottom: 0,
                                            background: 'rgba(255,255,255,0.06)',
                                            border: '1px solid var(--glass-border)',
                                            color: 'var(--text-main)'
                                        }}
                                        onClick={() => handleQuickAddToMeal(f, mt)}
                                    >
                                        {mt}
                                    </button>
                                ))}
                            </div>
                        </div>
                    ))
                )}
            </div>
        </div>
    );
}
