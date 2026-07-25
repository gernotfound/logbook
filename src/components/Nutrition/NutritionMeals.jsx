import React, { useState } from 'react';
import { useAuth } from '../../contexts/AuthContext';
import { COMMON_FOODS } from '../../lib/foods';

const MEAL_TYPES = ['Colazione', 'Pranzo', 'Cena', 'Spuntini'];

const NutritionMeals = () => {
    const { userData, saveUserData } = useAuth();
    
    const [searchQuery, setSearchQuery] = useState('');
    const [searchResults, setSearchResults] = useState([]);
    const [selectedMealType, setSelectedMealType] = useState(null);

    const todayDateStr = new Date().toISOString().split('T')[0];
    const todayNutrition = userData?.nutrition?.[todayDateStr] || { 
        kcal: 0, carbs: 0, pro: 0, fat: 0, meals: [] 
    };
    
    // Support legacy structure or new meals array
    const meals = todayNutrition.meals || [];

    const handleSearch = (query) => {
        setSearchQuery(query);
        if (query.trim().length > 1) {
            const q = query.toLowerCase();
            const res = COMMON_FOODS.filter(f => 
                f.name.toLowerCase().includes(q) || f.category.toLowerCase().includes(q)
            ).slice(0, 10);
            setSearchResults(res);
        } else {
            setSearchResults([]);
        }
    };

    const addFood = (food, mealType) => {
        // By default adding 1 portion based on baseQty
        const addedItem = {
            ...food,
            meal: mealType,
            quantity: food.baseQty,
            time: new Date().getTime()
        };

        const updatedMeals = [...meals, addedItem];
        
        // Recalculate daily totals
        let kcal = 0, carbs = 0, pro = 0, fat = 0;
        updatedMeals.forEach(m => {
            const ratio = m.quantity / m.baseQty;
            kcal += m.kcal * ratio;
            carbs += m.carbs * ratio;
            pro += m.pro * ratio;
            fat += m.fat * ratio;
        });

        const newNutritionDay = {
            ...todayNutrition,
            meals: updatedMeals,
            kcal: Math.round(kcal),
            carbs: Math.round(carbs),
            pro: Math.round(pro),
            fat: Math.round(fat)
        };

        const newNutritionObj = { ...(userData.nutrition || {}), [todayDateStr]: newNutritionDay };
        saveUserData({ ...userData, nutrition: newNutritionObj });
        
        setSearchQuery('');
        setSearchResults([]);
        setSelectedMealType(null);
    };

    const removeFood = (indexToRemove) => {
        const updatedMeals = meals.filter((_, idx) => idx !== indexToRemove);
        
        // Recalculate daily totals
        let kcal = 0, carbs = 0, pro = 0, fat = 0;
        updatedMeals.forEach(m => {
            const ratio = m.quantity / m.baseQty;
            kcal += m.kcal * ratio;
            carbs += m.carbs * ratio;
            pro += m.pro * ratio;
            fat += m.fat * ratio;
        });

        const newNutritionDay = {
            ...todayNutrition,
            meals: updatedMeals,
            kcal: Math.round(kcal),
            carbs: Math.round(carbs),
            pro: Math.round(pro),
            fat: Math.round(fat)
        };

        const newNutritionObj = { ...(userData.nutrition || {}), [todayDateStr]: newNutritionDay };
        saveUserData({ ...userData, nutrition: newNutritionObj });
    };

    return (
        <div>
            {/* Search Box */}
            <div className="card" style={{ position: 'relative', marginBottom: '15px' }}>
                <h3 style={{ marginBottom: '12px' }}>🔍 Cerca Alimento</h3>
                <input 
                    type="text" 
                    placeholder="Cerca es. Pollo, Avena..." 
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
                                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                                    <div>
                                        <div style={{ fontWeight: 'bold', color: 'var(--text-main)' }}>{f.name}</div>
                                        <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>
                                            {f.kcal} kcal / {f.baseQty}{f.unit} • C:{f.carbs} P:{f.pro} F:{f.fat}
                                        </div>
                                    </div>
                                    <div style={{ display: 'flex', gap: '5px' }}>
                                        {MEAL_TYPES.map(mt => (
                                            <button 
                                                key={mt}
                                                className="btn btn-small"
                                                style={{ padding: '5px', fontSize: '0.7rem' }}
                                                onClick={() => addFood(f, mt)}
                                            >
                                                + {mt.substring(0,3)}
                                            </button>
                                        ))}
                                    </div>
                                </div>
                            </div>
                        ))}
                    </div>
                )}
            </div>

            {/* Meals List */}
            {MEAL_TYPES.map(mt => {
                const mealItems = meals.filter(m => m.meal === mt);
                let subKcal = 0, subC = 0, subP = 0, subF = 0;
                mealItems.forEach(m => {
                    const ratio = m.quantity / m.baseQty;
                    subKcal += m.kcal * ratio;
                    subC += m.carbs * ratio;
                    subP += m.pro * ratio;
                    subF += m.fat * ratio;
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
                            mealItems.map((item, idx) => {
                                const realIdx = meals.findIndex(m => m.time === item.time && m.id === item.id);
                                return (
                                    <div key={idx} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '10px 0', borderBottom: '1px dashed var(--glass-border)' }}>
                                        <div>
                                            <div style={{ fontWeight: 'bold' }}>{item.name}</div>
                                            <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>{item.quantity}{item.unit}</div>
                                        </div>
                                        <button className="btn-icon" style={{ color: 'var(--danger-color)' }} onClick={() => removeFood(realIdx)}>✕</button>
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
