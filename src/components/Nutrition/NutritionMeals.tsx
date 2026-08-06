import { useState } from 'react';
import { useNutritionMeals } from '../../hooks/useNutritionMeals';
import CustomFoodModal from './CustomFoodModal';
import EditMealItemModal from './EditMealItemModal';

const MEAL_TYPES = ['Colazione', 'Pranzo', 'Cena', 'Spuntini'];

interface NutritionMealsProps {
    mealsHook?: ReturnType<typeof useNutritionMeals>;
}

export default function NutritionMeals({ mealsHook }: NutritionMealsProps) {
    const internalHook = useNutritionMeals();
    const hook = mealsHook || internalHook;
    const {
        searchQuery, handleSearch, searchResults, clearSearch,
        showCustomModal, setShowCustomModal,
        editingFoodId, cancelCustomFood,
        cfData, setCfData, saveCustomFood,
        meals, addFood, removeFood, updateMealItem
    } = hook;

    const [editingMealItem, setEditingMealItem] = useState<any | null>(null);

    return (
        <div>
            {/* Search Box */}
            <div className="card mb-15">
                <h3 className="mb-10">🔍 Cerca Alimento</h3>
                <div style={{ position: 'relative', display: 'flex', alignItems: 'center' }}>
                    <input 
                        type="text" 
                        placeholder="Cerca alimento (es. Pollo, Riso, Avena...)" 
                        value={searchQuery}
                        onChange={e => handleSearch(e.target.value)}
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
                            onClick={clearSearch}
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
                
                {/* Search Results List */}
                {searchResults.length > 0 && (
                    <div 
                        id="active-search-results"
                        style={{
                            display: 'block',
                            maxHeight: '280px',
                            overflowY: 'auto',
                            background: 'var(--surface-light)',
                            border: '1px solid var(--glass-border)',
                            borderRadius: '12px',
                            marginTop: '12px',
                            marginBottom: '12px',
                            boxShadow: '0 4px 16px rgba(0,0,0,0.5)'
                        }}
                    >
                        {searchResults.map((f: any, idx: number) => (
                            <div 
                                key={f.id || idx} 
                                style={{
                                    padding: '12px',
                                    borderBottom: idx === searchResults.length - 1 ? 'none' : '1px solid var(--glass-border)',
                                    background: 'rgba(255, 255, 255, 0.02)'
                                }}
                            >
                                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '10px' }}>
                                    <div style={{ flex: 1, minWidth: 0 }}>
                                        <div style={{ fontWeight: 'bold', fontSize: '0.95rem', color: 'var(--text-main)', display: 'flex', alignItems: 'center', flexWrap: 'wrap', gap: '6px' }}>
                                            <span>{f.name}</span>
                                            {f.isCustom && <span style={{ background: 'var(--warning-color)', color: '#000', padding: '2px 6px', borderRadius: '4px', fontSize: '0.7rem', fontWeight: 600 }}>Custom</span>}
                                        </div>
                                        <div style={{ fontSize: '0.8rem', color: 'var(--text-muted)', marginTop: '3px' }}>
                                            {f.kcal} kcal / {f.baseQty || 100}{f.unit || 'g'} • C:{f.carbs || 0}g P:{f.pro || 0}g F:{f.fat || 0}g
                                        </div>
                                    </div>
                                    <div style={{ display: 'flex', gap: '4px', flexShrink: 0 }}>
                                        {MEAL_TYPES.map(mt => (
                                            <button 
                                                key={mt}
                                                className="btn btn-small"
                                                style={{
                                                    padding: '6px 8px',
                                                    fontSize: '0.75rem',
                                                    marginBottom: 0,
                                                    background: 'rgba(255, 255, 255, 0.08)',
                                                    border: '1px solid var(--glass-border)',
                                                    color: 'var(--text-main)'
                                                }}
                                                onClick={() => addFood(f, mt)}
                                                title={`Aggiungi a ${mt}`}
                                            >
                                                {mt.substring(0, 3)}
                                            </button>
                                        ))}
                                    </div>
                                </div>
                            </div>
                        ))}
                    </div>
                )}

                {searchQuery.trim().length >= 2 && searchResults.length === 0 && (
                    <div style={{ padding: '12px', textAlign: 'center', color: 'var(--text-muted)', fontSize: '0.85rem', marginTop: '10px', background: 'rgba(255,255,255,0.02)', borderRadius: '8px', border: '1px dashed var(--glass-border)' }}>
                        Nessun alimento trovato. Puoi crearlo subito con <b>+ Crea Alimento</b>.
                    </div>
                )}

                <button 
                    type="button"
                    className="btn btn-primary" 
                    style={{ width: '100%', marginTop: '10px', marginBottom: 0 }}
                    onClick={() => {
                        if (showCustomModal) {
                            cancelCustomFood();
                        } else {
                            setShowCustomModal(true);
                        }
                    }}
                >
                    {showCustomModal ? '✕ Chiudi' : (editingFoodId ? '✏️ Modifica Alimento' : '+ Crea Alimento')}
                </button>
                
                <CustomFoodModal 
                    cfData={cfData} setCfData={setCfData} 
                    saveCustomFood={saveCustomFood} 
                    showCustomModal={showCustomModal} setShowCustomModal={setShowCustomModal} 
                    isEditing={!!editingFoodId}
                    onCancel={cancelCustomFood}
                />
            </div>

            {/* Meals List */}
            {MEAL_TYPES.map(mt => {
                const mealItems = meals.filter(m => m.meal === mt);
                let subKcal = 0, subC = 0, subP = 0, subF = 0;
                mealItems.forEach(m => {
                    const qty = m.quantity ?? m.baseQty ?? 100;
                    const base = m.baseQty ?? 100;
                    const ratio = base > 0 ? qty / base : 1;
                    subKcal += (parseFloat(m.kcal) || 0) * ratio;
                    subC += (parseFloat(m.carbs) || 0) * ratio;
                    subP += (parseFloat(m.pro) || 0) * ratio;
                    subF += (parseFloat(m.fat) || 0) * ratio;
                });

                return (
                    <div key={mt} className="card mb-15">
                        <div className="flex-between mb-10 pb-10 border-b">
                            <h3 className="m-0 text-primary">{mt}</h3>
                            <span className="text-sm text-muted">
                                {Math.round(subKcal)} kcal • C:{Math.round(subC)} P:{Math.round(subP)} F:{Math.round(subF)}
                            </span>
                        </div>
                        
                        {mealItems.length === 0 ? (
                            <p className="text-muted text-center my-10 text-sm">Nessun alimento aggiunto.</p>
                        ) : (
                            mealItems.map((item) => {
                                const qty = item.quantity ?? item.baseQty ?? 100;
                                const base = item.baseQty ?? 100;
                                const ratio = base > 0 ? qty / base : 1;
                                const itemKcal = Math.round((parseFloat(item.kcal) || 0) * ratio);

                                return (
                                    <div 
                                        key={item.time || item.id} 
                                        className="flex-between py-10 border-b-dashed"
                                        style={{ cursor: 'pointer', transition: 'background 0.2s', padding: '10px 6px', borderRadius: '8px' }}
                                        onClick={() => setEditingMealItem(item)}
                                        title="Clicca per modificare la porzione"
                                    >
                                        <div style={{ flex: 1 }}>
                                            <div className="font-bold flex items-center gap-6">
                                                <span>{item.name}</span>
                                                <span style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>✏️</span>
                                            </div>
                                            <div className="text-muted text-sm mt-2">
                                                {qty}{item.unit || 'g'} • {itemKcal} kcal
                                            </div>
                                        </div>
                                        <button 
                                            type="button"
                                            className="btn-icon text-danger" 
                                            onClick={(e) => {
                                                e.stopPropagation();
                                                removeFood(item.itemId || item.time || item.id);
                                            }}
                                            aria-label="Rimuovi alimento"
                                        >
                                            ✕
                                        </button>
                                    </div>
                                );
                            })
                        )}
                    </div>
                );
            })}

            {/* Modal to edit logged meal item on click */}
            {editingMealItem && (
                <EditMealItemModal 
                    item={editingMealItem}
                    onClose={() => setEditingMealItem(null)}
                    onSave={updateMealItem}
                    onDelete={removeFood}
                />
            )}
        </div>
    );
}
