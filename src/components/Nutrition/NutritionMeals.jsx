import React, { useState } from 'react';
import { useAuth } from '../../contexts/AuthContext';
import { COMMON_FOODS } from '../../lib/foods';
import { Logic } from '../../lib/logic';

const MEAL_TYPES = ['Colazione', 'Pranzo', 'Cena', 'Spuntini'];

const NutritionMeals = () => {
    const { userData, saveUserData } = useAuth();
    
    const [searchQuery, setSearchQuery] = useState('');
    const [searchResults, setSearchResults] = useState([]);
    
    // Custom Food Modal State
    const [showCustomModal, setShowCustomModal] = useState(false);
    const [cfData, setCfData] = useState({
        name: '', brand: '', unit: 'g', pieceWeight: '',
        kcal: '', carbs: '', pro: '', fat: ''
    });

    const todayDateStr = new Date().toISOString().split('T')[0];
    const todayNutrition = userData?.nutrition?.[todayDateStr] || { 
        kcal: 0, carbs: 0, pro: 0, fat: 0, meals: [] 
    };
    
    const meals = todayNutrition.meals || [];

    const handleSearch = (query) => {
        setSearchQuery(query);
        if (query.trim().length > 1) {
            const q = query.toLowerCase();
            const customFoods = userData?.customFoods || [];
            const combined = [...COMMON_FOODS, ...customFoods];
            const res = combined.filter(f => 
                (f.name || '').toLowerCase().includes(q) || 
                (f.category || '').toLowerCase().includes(q) ||
                (f.brand || '').toLowerCase().includes(q)
            ).slice(0, 10);
            setSearchResults(res);
        } else {
            setSearchResults([]);
        }
    };

    const addFood = (food, mealType) => {
        const addedItem = {
            id: food.id,
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

        const updatedMeals = [...meals, addedItem];
        const { kcal, carbs, pro, fat } = recalcTotals(updatedMeals);

        const newNutritionDay = {
            ...todayNutrition,
            meals: updatedMeals,
            kcal, carbs, pro, fat
        };

        const newNutritionObj = { ...(userData.nutrition || {}), [todayDateStr]: newNutritionDay };
        saveUserData({ ...userData, nutrition: newNutritionObj });
        
        setSearchQuery('');
        setSearchResults([]);
    };

    const removeFood = (itemTime) => {
        const updatedMeals = meals.filter(m => m.time !== itemTime);
        const { kcal, carbs, pro, fat } = recalcTotals(updatedMeals);

        const newNutritionDay = {
            ...todayNutrition,
            meals: updatedMeals,
            kcal, carbs, pro, fat
        };

        const newNutritionObj = { ...(userData.nutrition || {}), [todayDateStr]: newNutritionDay };
        saveUserData({ ...userData, nutrition: newNutritionObj });
    };

    const recalcTotals = (mealsList) => {
        let kcal = 0, carbs = 0, pro = 0, fat = 0;
        mealsList.forEach(m => {
            const ratio = (m.quantity || m.baseQty || 100) / (m.baseQty || 100);
            kcal += (parseFloat(m.kcal) || 0) * ratio;
            carbs += (parseFloat(m.carbs) || 0) * ratio;
            pro += (parseFloat(m.pro) || 0) * ratio;
            fat += (parseFloat(m.fat) || 0) * ratio;
        });
        return {
            kcal: Math.round(kcal),
            carbs: Math.round(carbs * 10) / 10,
            pro: Math.round(pro * 10) / 10,
            fat: Math.round(fat * 10) / 10
        };
    };

    const saveCustomFood = () => {
        const foodData = {
            ...cfData,
            baseQty: 100,
            servingWeight: cfData.unit === 'pezzo' ? cfData.pieceWeight : null
        };
        
        const validation = Logic.validateCustomFood(foodData);
        if (!validation.isValid) {
            alert("Attenzione: errori nei dati dell'alimento:\n" + Object.values(validation.errors).join('\n'));
            return;
        }

        const customFoods = userData?.customFoods || [];
        const updatedCustomFoods = [...customFoods, validation.cleanData];
        saveUserData({ ...userData, customFoods: updatedCustomFoods });
        
        setShowCustomModal(false);
        setCfData({ name: '', brand: '', unit: 'g', pieceWeight: '', kcal: '', carbs: '', pro: '', fat: '' });
        alert("Alimento custom salvato!");
    };

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
                
                {/* Custom Food Creation UI */}
                {showCustomModal && (
                    <div style={{ marginTop: '15px', paddingTop: '15px', borderTop: '1px solid var(--glass-border)' }}>
                        <div style={{ marginBottom: '10px' }}>
                            <input type="text" placeholder="Nome alimento (obbligatorio)" value={cfData.name} onChange={e => setCfData({...cfData, name: e.target.value})} style={{ marginBottom: '8px' }} />
                            <input type="text" placeholder="Marca (opzionale)" value={cfData.brand} onChange={e => setCfData({...cfData, brand: e.target.value})} style={{ marginBottom: '8px' }} />
                        </div>
                        
                        <div className="input-row" style={{ marginBottom: '10px' }}>
                            <div style={{ flex: 1 }}>
                                <select value={cfData.unit} onChange={e => setCfData({...cfData, unit: e.target.value})} style={{ width: '100%', padding: '10px' }}>
                                    <option value="g">Grammi (g)</option>
                                    <option value="ml">Millilitri (ml)</option>
                                    <option value="pezzo">A pezzo / Unità</option>
                                </select>
                            </div>
                            {cfData.unit === 'pezzo' && (
                                <div style={{ flex: 1 }}>
                                    <input type="number" placeholder="Peso 1 pezzo (g)" value={cfData.pieceWeight} onChange={e => setCfData({...cfData, pieceWeight: e.target.value})} />
                                </div>
                            )}
                        </div>

                        <div style={{ fontSize: '0.8rem', color: 'var(--text-muted)', marginBottom: '8px' }}>Valori per 100 {cfData.unit !== 'pezzo' ? cfData.unit : 'g'}:</div>
                        
                        <div className="input-row" style={{ marginBottom: '10px' }}>
                            <input type="number" placeholder="Kcal" value={cfData.kcal} onChange={e => setCfData({...cfData, kcal: e.target.value})} style={{ flex: 1 }} />
                            <input type="number" placeholder="Carbo (g)" value={cfData.carbs} onChange={e => setCfData({...cfData, carbs: e.target.value})} style={{ flex: 1 }} />
                            <input type="number" placeholder="Pro (g)" value={cfData.pro} onChange={e => setCfData({...cfData, pro: e.target.value})} style={{ flex: 1 }} />
                            <input type="number" placeholder="Grassi (g)" value={cfData.fat} onChange={e => setCfData({...cfData, fat: e.target.value})} style={{ flex: 1 }} />
                        </div>

                        <button className="btn btn-primary" style={{ width: '100%' }} onClick={saveCustomFood}>
                            💾 Salva nei miei alimenti
                        </button>
                    </div>
                )}
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
};

export default NutritionMeals;
