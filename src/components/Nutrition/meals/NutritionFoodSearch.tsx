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
        <section className="tracking-panel">
            <h2 className="tracking-heading">Cerca alimento</h2>
            <div className="tracking-search">
                <input
                    type="search"
                    aria-label="Cerca alimento"
                    placeholder="Cerca alimento (es. Pollo, Riso, Avena...)"
                    value={searchQuery}
                    onChange={e => handleSearch(e.target.value)}
                    onFocus={e => e.target.select()}
                />
                {searchQuery && (
                    <button
                        type="button"
                        onClick={clearSearch}
                        className="btn-icon"
                        aria-label="Cancella ricerca"
                    >
                        <X size={20} aria-hidden="true" />
                    </button>
                )}
            </div>

            {searchResults.length > 0 && (
                <div id="active-search-results" className="tracking-search-results" aria-label="Alimenti trovati">
                    {searchResults.map((food: any, idx: number) => (
                        <div key={food.id || idx} className="tracking-food-result">
                            <div className="tracking-row tracking-row--wrap">
                                <div>
                                    <div className="font-bold flex items-center gap-6">
                                        <span>{food.name}</span>
                                        {food.isCustom && <span className="tracking-badge">Personalizzato</span>}
                                    </div>
                                    <div className="tracking-muted text-sm mt-4">
                                        {food.kcal} kcal / {food.baseQty || 100}{food.unit || 'g'} • P:{food.pro || 0}g C:{food.carbs || 0}g G:{food.fat || 0}g
                                    </div>
                                </div>
                                <div className="tracking-quick-meals">
                                    {mealTypes.map(mealType => (
                                        <button
                                            key={mealType}
                                            type="button"
                                            className="btn btn-secondary"
                                            onClick={() => addFood(food, mealType)}
                                            title={`Aggiungi a ${mealType}`}
                                        >
                                            {mealType}
                                        </button>
                                    ))}
                                </div>
                            </div>
                        </div>
                    ))}
                </div>
            )}

            {searchQuery.trim().length >= 2 && searchResults.length === 0 && (
                <p className="tracking-empty" role="status">
                    Nessun alimento trovato. Puoi crearlo subito con <b>+ Crea alimento</b>.
                </p>
            )}

            <button
                type="button"
                className="btn btn-primary tracking-full-button"
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
        </section>
    );
}
