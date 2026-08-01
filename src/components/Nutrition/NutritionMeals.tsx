import { useNutritionMeals } from '../../hooks/useNutritionMeals';
import CustomFoodModal from './CustomFoodModal';

const MEAL_TYPES = ['Colazione', 'Pranzo', 'Cena', 'Spuntini'];

export default function NutritionMeals() {
    const {
        searchQuery, handleSearch, searchResults,
        isSearchingOnline, handleOnlineSearch,
        showCustomModal, setShowCustomModal,
        cfData, setCfData, saveCustomFood,
        meals, addFood, removeFood
    } = useNutritionMeals();

    return (
        <div>
            {/* Search Box */}
            <div className="card mb-15" style={{ position: 'relative' }}>
                <h3 className="mb-10">🔍 Cerca Alimento</h3>
                <div className="flex gap-10">
                    <input 
                        type="text" 
                        placeholder="Cerca es. Pollo, Avena, o alimento custom..." 
                        value={searchQuery}
                        onChange={e => handleSearch(e.target.value)}
                        className="m-0 flex-1" 
                    />
                    <button 
                        className="btn btn-primary" 
                        onClick={handleOnlineSearch}
                        disabled={isSearchingOnline || searchQuery.trim().length < 2}
                        style={{ padding: '0 15px', whiteSpace: 'nowrap' }}
                    >
                        {isSearchingOnline ? '⏳' : '🌐 Online'}
                    </button>
                </div>
                
                {searchResults.length > 0 && (
                    <div style={{
                        position: 'absolute', top: '100%', left: 0, right: 0,
                        zIndex: 100, maxHeight: '250px',
                        boxShadow: '0 4px 12px rgba(0,0,0,0.5)'
                    }} className="bg-surface border-glass rounded-10 overflow-y-auto mt-5">
                        {searchResults.map((f: any, idx: number) => (
                            <div key={f.id || idx} className="p-12 border-b">
                                <div className="flex-between gap-10">
                                    <div className="flex-1" style={{ minWidth: 0 }}>
                                        <div className="font-bold text-md" style={{ color: 'var(--text-main)' }}>
                                            {f.name}
                                            {f.isCustom && <span className="bg-warning text-black p-4 rounded-4 text-xs ml-5">Custom</span>}
                                            {f.isOnline && <span className="p-4 rounded-4 text-xs ml-5" style={{ background: '#4db6ac', color: '#000' }}>API</span>}
                                        </div>
                                        <div className="text-muted text-sm">
                                            {f.kcal} kcal / {f.baseQty}{f.unit} • C:{f.carbs} P:{f.pro} F:{f.fat}
                                        </div>
                                    </div>
                                    <div className="flex gap-4 flex-shrink-0">
                                        {MEAL_TYPES.map(mt => (
                                            <button 
                                                key={mt}
                                                className="btn btn-small p-4 text-xs"
                                                onClick={() => addFood(f, mt)}
                                            >
                                                {mt.substring(0,3)}
                                            </button>
                                        ))}
                                    </div>
                                </div>
                            </div>
                        ))}
                    </div>
                )}

                <button 
                    className="btn btn-small w-full mt-10 bg-card-inner border-dashed" 
                    onClick={() => setShowCustomModal(!showCustomModal)}
                >
                    + Crea Alimento Custom
                </button>
                
                <CustomFoodModal 
                    cfData={cfData} setCfData={setCfData} 
                    saveCustomFood={saveCustomFood} 
                    showCustomModal={showCustomModal} setShowCustomModal={setShowCustomModal} 
                />
            </div>

            {/* Meals List */}
            {MEAL_TYPES.map(mt => {
                const mealItems = meals.filter(m => m.meal === mt);
                let subKcal = 0, subC = 0, subP = 0, subF = 0;
                mealItems.forEach(m => {
                    const qty = m.quantity ?? m.baseQty ?? 100;
                    const base = m.baseQty ?? 100;
                    const ratio = qty / base;
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
                                return (
                                    <div key={item.time || item.id} className="flex-between py-10 border-b-dashed">
                                        <div>
                                            <div className="font-bold">{item.name}</div>
                                            <div className="text-muted text-sm">{item.quantity ?? item.baseQty}{item.unit}</div>
                                        </div>
                                        <button className="btn-icon text-danger" onClick={() => removeFood(item.itemId || item.time)}>✕</button>
                                    </div>
                                )
                            })
                        )}
                    </div>
                );
            })}
        </div>
    );
}
