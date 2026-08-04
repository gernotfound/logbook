import { useNutritionMeals } from '../../hooks/useNutritionMeals';
import CustomFoodModal from './CustomFoodModal';

const MEAL_TYPES = ['Colazione', 'Pranzo', 'Cena', 'Spuntini'];

export default function NutritionMeals() {
    const {
        searchQuery, handleSearch, searchResults, clearSearch,
        isSearchingOnline, handleOnlineSearch,
        showCustomModal, setShowCustomModal,
        cfData, setCfData, saveCustomFood,
        meals, addFood, removeFood
    } = useNutritionMeals();

    return (
        <div>
            {/* Search Box */}
            <div className="card mb-15">
                <h3 className="mb-10">🔍 Cerca Alimento</h3>
                <div className="flex gap-10">
                    <div style={{ position: 'relative', flex: 1, display: 'flex', alignItems: 'center' }}>
                        <input 
                            type="text" 
                            placeholder="Cerca es. Pollo, Avena, o alimento custom..." 
                            value={searchQuery}
                            onChange={e => handleSearch(e.target.value)}
                            className="m-0"
                            style={{ width: '100%', paddingRight: searchQuery ? '36px' : '12px' }}
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
                                    padding: '4px'
                                }}
                                aria-label="Cancella ricerca"
                            >
                                ✕
                            </button>
                        )}
                    </div>
                    <button 
                        className="btn btn-primary" 
                        onClick={handleOnlineSearch}
                        disabled={isSearchingOnline || searchQuery.trim().length < 2}
                        style={{ padding: '0 15px', whiteSpace: 'nowrap', marginBottom: 0 }}
                    >
                        {isSearchingOnline ? '⏳ Ricerca...' : '🌐 Online'}
                    </button>
                </div>
                
                {/* Search Results List (In-Flow, Solid Opaque Background) */}
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
                                            {f.isOnline && <span style={{ background: '#4db6ac', color: '#000', padding: '2px 6px', borderRadius: '4px', fontSize: '0.7rem', fontWeight: 600 }}>API</span>}
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

                {searchQuery.trim().length >= 2 && searchResults.length === 0 && !isSearchingOnline && (
                    <div style={{ padding: '12px', textAlign: 'center', color: 'var(--text-muted)', fontSize: '0.85rem', marginTop: '10px', background: 'rgba(255,255,255,0.02)', borderRadius: '8px', border: '1px dashed var(--glass-border)' }}>
                        Nessun alimento trovato in locale. Clicca <b>🌐 Online</b> per cercare nel database.
                    </div>
                )}

                <button 
                    className="btn btn-small" 
                    style={{ width: '100%', marginTop: '10px', background: 'rgba(255, 255, 255, 0.04)', border: '1px dashed var(--glass-border)', marginBottom: 0 }}
                    onClick={() => setShowCustomModal(!showCustomModal)}
                >
                    {showCustomModal ? '✕ Chiudi Alimento Custom' : '+ Crea Alimento Custom'}
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
                                );
                            })
                        )}
                    </div>
                );
            })}
        </div>
    );
}
