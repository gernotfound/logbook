import React from 'react';
import { useNutritionMeals } from '../../hooks/useNutritionMeals';
import CustomFoodModal from './CustomFoodModal';

const MEAL_TYPES = ['Colazione', 'Pranzo', 'Cena', 'Spuntini'];

export default function NutritionMeals() {
    const {
        searchQuery, handleSearch, searchResults,
        showCustomModal, setShowCustomModal,
        cfData, setCfData, saveCustomFood,
        meals, addFood, removeFood
    } = useNutritionMeals();

    return (
        <div>
            {/* Search Box */}
            <div className="card" style={{ position: 'relative', marginBottom: '15px' }}>
                <h3 style={{ marginBottom: '12px' }}>🔍 Cerca Alimento</h3>
                <input 
                    type="text" 
                    placeholder="Cerca es. Pollo, Avena, o alimento custom..." 
                    value={searchQuery}
                    onChange={e => handleSearch(e.target.value)}
                    style={{ margin: 0 }} 
                />
                
                {searchResults.length > 0 && (
                    <div style={{
                        position: 'absolute', top: '100%', left: 0, right: 0,
                        background: 'var(--surface-color)', border: '1px solid var(--glass-border)',
                        borderRadius: '10px', zIndex: 100, maxHeight: '250px', overflowY: 'auto',
                        boxShadow: '0 4px 12px rgba(0,0,0,0.5)', marginTop: '5px'
                    }}>
                        {searchResults.map(f => (
                            <div key={f.id} style={{ padding: '12px', borderBottom: '1px solid var(--glass-border)' }}>
                                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '10px' }}>
                                    <div style={{ flex: 1, minWidth: 0 }}>
                                        <div style={{ fontWeight: 'bold', color: 'var(--text-main)', fontSize: '0.9rem' }}>
                                            {f.name}
                                            {f.isCustom && <span style={{ marginLeft: '5px', fontSize: '0.65rem', background: 'var(--warning-color)', color: '#000', padding: '2px 5px', borderRadius: '4px' }}>Custom</span>}
                                        </div>
                                        <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>
                                            {f.kcal} kcal / {f.baseQty}{f.unit} • C:{f.carbs} P:{f.pro} F:{f.fat}
                                        </div>
                                    </div>
                                    <div style={{ display: 'flex', gap: '4px', flexShrink: 0 }}>
                                        {MEAL_TYPES.map(mt => (
                                            <button 
                                                key={mt}
                                                className="btn btn-small"
                                                style={{ padding: '4px 6px', fontSize: '0.65rem' }}
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
                    className="btn btn-small" 
                    style={{ width: '100%', marginTop: '10px', background: 'rgba(255,255,255,0.05)', border: '1px dashed var(--glass-border)' }}
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
                    const ratio = (m.quantity || m.baseQty || 100) / (m.baseQty || 100);
                    subKcal += (parseFloat(m.kcal) || 0) * ratio;
                    subC += (parseFloat(m.carbs) || 0) * ratio;
                    subP += (parseFloat(m.pro) || 0) * ratio;
                    subF += (parseFloat(m.fat) || 0) * ratio;
                });

                return (
                    <div key={mt} className="card" style={{ marginBottom: '15px' }}>
                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '10px', borderBottom: '1px solid var(--glass-border)', paddingBottom: '10px' }}>
                            <h3 style={{ margin: 0, color: 'var(--primary-color)' }}>{mt}</h3>
                            <span style={{ fontSize: '0.8rem', color: 'var(--text-muted)' }}>
                                {Math.round(subKcal)} kcal • C:{Math.round(subC)} P:{Math.round(subP)} F:{Math.round(subF)}
                            </span>
                        </div>
                        
                        {mealItems.length === 0 ? (
                            <p style={{ fontSize: '0.85rem', color: 'var(--text-muted)', textAlign: 'center', margin: '10px 0' }}>Nessun alimento aggiunto.</p>
                        ) : (
                            mealItems.map((item) => {
                                return (
                                    <div key={item.time || item.id} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '10px 0', borderBottom: '1px dashed var(--glass-border)' }}>
                                        <div>
                                            <div style={{ fontWeight: 'bold' }}>{item.name}</div>
                                            <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>{item.quantity || item.baseQty}{item.unit}</div>
                                        </div>
                                        <button className="btn-icon" style={{ color: 'var(--danger-color)' }} onClick={() => removeFood(item.time)}>✕</button>
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
