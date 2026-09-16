import { Pencil, Plus, X } from 'lucide-react';
import type { useNutritionMeals } from '../../../hooks/useNutritionMeals';
import CustomFoodForm from '../CustomFoodForm';

type NutritionMealsHook = ReturnType<typeof useNutritionMeals>;

interface NutritionFoodSearchProps {
    mealTypes: readonly string[];
    searchQuery: NutritionMealsHook['searchQuery'];
    handleSearch: NutritionMealsHook['handleSearch'];
    searchResults: NutritionMealsHook['searchResults'];
    clearSearch: NutritionMealsHook['clearSearch'];
    showCustomModal: NutritionMealsHook['showCustomModal'];
    setShowCustomModal: NutritionMealsHook['setShowCustomModal'];
    editingFoodId: NutritionMealsHook['editingFoodId'];
    cancelCustomFood: NutritionMealsHook['cancelCustomFood'];
    cfData: NutritionMealsHook['cfData'];
    setCfData: NutritionMealsHook['setCfData'];
    saveCustomFood: NutritionMealsHook['saveCustomFood'];
    addFood: NutritionMealsHook['addFood'];
}

export function NutritionFoodSearch({
    mealTypes,
    searchQuery,
    handleSearch,
    searchResults,
    clearSearch,
    showCustomModal,
    setShowCustomModal,
    editingFoodId,
    cancelCustomFood,
    cfData,
    setCfData,
    saveCustomFood,
    addFood,
}: NutritionFoodSearchProps) {
    return (
        <div className="section-divider">
            <h2 className="mb-10" style={{color: 'var(--text-main)'}}>🔍 Cerca alimento</h2>
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
                    {searchResults.map((food: any, idx: number) => (
                        <div
                            key={food.id || idx}
                            style={{
                                padding: '12px',
                                borderBottom: idx === searchResults.length - 1 ? 'none' : '1px solid var(--glass-border)',
                                background: 'rgba(255, 255, 255, 0.02)'
                            }}
                        >
                            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '10px' }}>
                                <div style={{ flex: 1, minWidth: 0 }}>
                                    <div style={{ fontWeight: 'bold', fontSize: '0.95rem', color: 'var(--text-main)', display: 'flex', alignItems: 'center', flexWrap: 'wrap', gap: '6px' }}>
                                        <span>{food.name}</span>
                                        {food.isCustom && <span style={{ background: 'var(--warning-color)', color: '#000', padding: '2px 6px', borderRadius: '4px', fontSize: '0.75rem', fontWeight: 600 }}>Custom</span>}
                                    </div>
                                    <div style={{ fontSize: '0.85rem', color: 'var(--text-muted)', marginTop: '3px' }}>
                                        {food.kcal} kcal / {food.baseQty || 100}{food.unit || 'g'} • P:{food.pro || 0}g C:{food.carbs || 0}g G:{food.fat || 0}g
                                    </div>
                                </div>
                                <div style={{ display: 'flex', gap: '4px', flexShrink: 0 }}>
                                    {mealTypes.map(mealType => (
                                        <button
                                            key={mealType}
                                            className="btn btn-small"
                                            style={{
                                                padding: '6px 8px',
                                                fontSize: '0.75rem',
                                                marginBottom: 0,
                                                background: 'rgba(255, 255, 255, 0.08)',
                                                border: '1px solid var(--glass-border)',
                                                color: 'var(--text-main)'
                                            }}
                                            onClick={() => addFood(food, mealType)}
                                            title={`Aggiungi a ${mealType}`}
                                        >
                                            {mealType.substring(0, 3)}
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
                    Nessun alimento trovato. Puoi crearlo subito con <b>+ Crea alimento</b>.
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
                {showCustomModal ? <><X size={16} aria-hidden="true" /> Chiudi</> : (editingFoodId ? <><Pencil size={16} aria-hidden="true" /> Modifica alimento</> : <><Plus size={16} aria-hidden="true" /> Crea alimento</>)}
            </button>

            <CustomFoodForm
                cfData={cfData}
                setCfData={setCfData}
                saveCustomFood={saveCustomFood}
                showCustomModal={showCustomModal}
                setShowCustomModal={setShowCustomModal}
                isEditing={!!editingFoodId}
                onCancel={cancelCustomFood}
            />
        </div>
    );
}
