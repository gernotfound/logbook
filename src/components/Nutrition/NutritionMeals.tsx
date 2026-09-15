import { useState } from 'react';
import { Pencil, Plus, X } from 'lucide-react';
import { shiftDateString } from '../../lib/utils/date';
import { useNutritionMeals } from '../../hooks/useNutritionMeals';
import CustomFoodForm from './CustomFoodForm';
import InlineEditMealItem from './InlineEditMealItem';
import { useDialogStore } from '../../store/useDialogStore';
import { useSupplements } from '../../hooks/useSupplements';

import { Logic } from '../../lib/logic';

const MEAL_TYPES = ['Colazione', 'Pranzo', 'Cena', 'Spuntini'];

interface NutritionMealsProps {
    mealsHook?: ReturnType<typeof useNutritionMeals>;
    selectedDate?: string;
    setSelectedDate?: (d: string) => void;
}

export default function NutritionMeals({ mealsHook, selectedDate, setSelectedDate }: NutritionMealsProps) {
    const internalHook = useNutritionMeals(selectedDate);
    const hook = mealsHook || internalHook;
    const {
        todayNutrition, dailyTarget, isDayOn, setDayType,
        searchQuery, handleSearch, searchResults, clearSearch,
        showCustomModal, setShowCustomModal,
        editingFoodId, cancelCustomFood,
        cfData, setCfData, saveCustomFood,
        meals, addFood, removeFood, updateMealItem, targetDateStr
    } = hook;
    
    const { removeIntake, supplementsLibrary } = useSupplements(selectedDate);

    const showConfirm = useDialogStore(s => s.showConfirm);

    const [editingMealItem, setEditingMealItem] = useState<any | null>(null);

    const handlePrevDay = () => {
        if (!setSelectedDate || !targetDateStr) return;
        setSelectedDate(shiftDateString(targetDateStr, -1));
    };

    const handleNextDay = () => {
        if (!setSelectedDate || !targetDateStr) return;
        const today = Logic.getLocalDateString();
        if (targetDateStr === today) return;
        setSelectedDate(shiftDateString(targetDateStr, 1));
    };

    const handleToday = () => {
        if (setSelectedDate) setSelectedDate(Logic.getLocalDateString());
    };

    return (
        <div>
            {/* Date Navigator */}
            {setSelectedDate && (
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '15px' }}>
                    <button className="btn btn-small" onClick={handlePrevDay} style={{ background: 'rgba(255,255,255,0.05)', color: 'var(--text-main)' }}>◀ Prec.</button>
                    <div style={{ textAlign: 'center', flex: 1, margin: '0 10px', cursor: 'pointer' }} onClick={handleToday} title="Torna a oggi">
                        <div style={{ fontWeight: 'bold', fontSize: '1.1rem' }}>
                            {Logic.formatItalianDate ? Logic.formatItalianDate(targetDateStr || '') : targetDateStr}
                        </div>
                        {targetDateStr === Logic.getLocalDateString() && (
                            <div style={{ fontSize: '0.75rem', color: 'var(--primary-color)' }}>OGGI</div>
                        )}
                    </div>
                    <button className="btn btn-small" onClick={handleNextDay} disabled={targetDateStr === Logic.getLocalDateString()} style={{ background: 'rgba(255,255,255,0.05)', color: 'var(--text-main)', opacity: targetDateStr === Logic.getLocalDateString() ? 0.3 : 1 }}>Succ. ▶</button>
                </div>
            )}

            {/* Daily Target Progress Header */}
            <div className="section-divider">
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '8px', background: 'rgba(255,255,255,0.05)', padding: '10px 15px', borderRadius: '10px' }}>
                    <div style={{ fontSize: '1.1rem', fontWeight: 'bold', color: isDayOn ? 'var(--primary-color)' : 'var(--text-main)' }}>
                        {isDayOn ? '🔥 Giorno ON' : '🛋️ Giorno OFF'}
                    </div>
                    <button 
                        className="btn btn-small"
                        onClick={async () => {
                            const confirmed = await showConfirm(`Sei sicuro di voler cambiare il giorno in ${isDayOn ? 'OFF' : 'ON'}?`);
                            if (confirmed) {
                                setDayType(!isDayOn);
                            }
                        }}
                        style={{ margin: 0 }}
                    >
                        Cambia giorno
                    </button>
                </div>
                
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '15px' }}>
                    <div>
                        <div style={{ fontSize: '1.8rem', fontWeight: 800, color: 'var(--text-main)' }}>{Math.round(todayNutrition.kcal)}</div>
                        <div style={{ fontSize: '0.85rem', color: 'var(--text-muted)' }}>kcal assunte</div>
                    </div>
                    <div style={{ textAlign: 'right' }}>
                        <div style={{ fontSize: '1.2rem', fontWeight: 'bold', color: 'var(--text-main)' }}>{dailyTarget.kcal || 0}</div>
                        <div style={{ fontSize: '0.85rem', color: 'var(--text-muted)' }}>TDEE target</div>
                    </div>
                </div>

                <div className="progress-bg" style={{ marginBottom: '20px' }}>
                    <div className="progress-fill" style={{ width: `${dailyTarget.kcal > 0 ? Math.min((todayNutrition.kcal / dailyTarget.kcal) * 100, 100) : 0}%`, background: 'linear-gradient(90deg, var(--warning-color), #fcd34d)' }}></div>
                </div>

                <div style={{ display: 'flex', justifyContent: 'space-between', gap: '8px' }}>
                    <div style={{ flex: 1, background: 'rgba(0,0,0,0.3)', padding: '10px 5px', borderRadius: '10px', textAlign: 'center' }}>
                        <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)', fontWeight: 'bold' }}>PRO</div>
                        <div style={{ fontSize: '0.95rem', fontWeight: 'bold', color: 'var(--text-main)' }}>{Math.round(todayNutrition.pro)}<span style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>/{dailyTarget.pro}</span></div>
                        <div className="progress-bg" style={{ height: '4px', marginTop: '6px' }}><div className="progress-fill" style={{ background: 'var(--success-color)', width: `${dailyTarget.pro > 0 ? Math.min((todayNutrition.pro / dailyTarget.pro) * 100, 100) : 0}%` }}></div></div>
                    </div>
                    <div style={{ flex: 1, background: 'rgba(0,0,0,0.3)', padding: '10px 5px', borderRadius: '10px', textAlign: 'center' }}>
                        <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)', fontWeight: 'bold' }}>CAR</div>
                        <div style={{ fontSize: '0.95rem', fontWeight: 'bold', color: 'var(--text-main)' }}>{Math.round(todayNutrition.carbs)}<span style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>/{dailyTarget.carbs}</span></div>
                        <div className="progress-bg" style={{ height: '4px', marginTop: '6px' }}><div className="progress-fill" style={{ background: 'var(--primary-color)', width: `${dailyTarget.carbs > 0 ? Math.min((todayNutrition.carbs / dailyTarget.carbs) * 100, 100) : 0}%` }}></div></div>
                    </div>
                    <div style={{ flex: 1, background: 'rgba(0,0,0,0.3)', padding: '10px 5px', borderRadius: '10px', textAlign: 'center' }}>
                        <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)', fontWeight: 'bold' }}>GRA</div>
                        <div style={{ fontSize: '0.95rem', fontWeight: 'bold', color: 'var(--text-main)' }}>{Math.round(todayNutrition.fat)}<span style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>/{dailyTarget.fat}</span></div>
                        <div className="progress-bg" style={{ height: '4px', marginTop: '6px' }}><div className="progress-fill" style={{ background: 'var(--danger-color)', width: `${dailyTarget.fat > 0 ? Math.min((todayNutrition.fat / dailyTarget.fat) * 100, 100) : 0}%` }}></div></div>
                    </div>
                </div>
            </div>

            {/* Search Box */}
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
                                            {f.isCustom && <span style={{ background: 'var(--warning-color)', color: '#000', padding: '2px 6px', borderRadius: '4px', fontSize: '0.75rem', fontWeight: 600 }}>Custom</span>}
                                        </div>
                                        <div style={{ fontSize: '0.85rem', color: 'var(--text-muted)', marginTop: '3px' }}>
                                            {f.kcal} kcal / {f.baseQty || 100}{f.unit || 'g'} • P:{f.pro || 0}g C:{f.carbs || 0}g G:{f.fat || 0}g
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
                    const base = m.baseQty !== undefined && m.baseQty !== null && m.baseQty > 0
                        ? m.baseQty
                        : (m.unit === 'porzione' || m.meal === 'quick' ? 1 : 100);
                    const qty = m.quantity !== undefined && m.quantity !== null
                        ? m.quantity
                        : base;
                    const ratio = base > 0 ? qty / base : 1;
                    subKcal += (Number(m.kcal) || 0) * ratio;
                    subC += (Number(m.carbs) || 0) * ratio;
                    subP += (Number(m.pro) || 0) * ratio;
                    subF += (Number(m.fat) || 0) * ratio;
                });

                return (
                    <div key={mt} className="section-divider">
                        <div className="flex-between mb-10 pb-10 border-b">
                            <h2 className="m-0" style={{color: 'var(--text-main)'}}>{mt}</h2>
                            <span className="text-sm text-muted">
                                {Math.round(subKcal)} kcal • P:{Math.round(subP)} C:{Math.round(subC)} G:{Math.round(subF)}
                            </span>
                        </div>
                        
                        {mealItems.length === 0 ? (
                            <p className="text-muted text-center my-10 text-sm">Nessun alimento aggiunto.</p>
                        ) : (
                            mealItems.map((item) => {
                                const base = item.baseQty !== undefined && item.baseQty !== null && item.baseQty > 0
                                    ? item.baseQty
                                    : (item.unit === 'porzione' || item.meal === 'quick' ? 1 : 100);
                                const qty = item.quantity !== undefined && item.quantity !== null
                                    ? item.quantity
                                    : base;
                                const ratio = base > 0 ? qty / base : 1;
                                const itemKcal = Math.round((Number(item.kcal) || 0) * ratio);

                                const isEditing = editingMealItem && (editingMealItem.time === item.time || editingMealItem.id === item.id);

                                if (isEditing) {
                                    return (
                                        <InlineEditMealItem 
                                            key={`edit-${item.time || item.id}`}
                                            item={editingMealItem}
                                            onClose={() => setEditingMealItem(null)}
                                            onSave={updateMealItem}
                                            onDelete={removeFood}
                                        />
                                    );
                                }

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
                                                <Pencil size={16} aria-hidden="true" />
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
                                                removeFood(item.time ?? item.id);
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

            {/* Supplements List */}
            {todayNutrition?.supplementsIntake && todayNutrition.supplementsIntake.length > 0 && (
                <div className="section-divider-last">
                    <div className="flex-between mb-10 pb-10 border-b">
                        <h2 className="m-0" style={{color: 'var(--text-main)'}}>Integratori</h2>
                        <span className="text-sm text-muted">
                            {todayNutrition.supplementsIntake.length} assunzioni
                        </span>
                    </div>
                    
                    {todayNutrition.supplementsIntake.map((intake: any) => {
                        const supp = supplementsLibrary.find(s => s.id === intake.supplementId);
                        const timeStr = new Date(intake.time).toLocaleTimeString('it-IT', { hour: '2-digit', minute: '2-digit' });
                        return (
                            <div 
                                key={intake.id} 
                                className="flex-between py-10 border-b-dashed"
                                style={{ padding: '10px 6px', borderRadius: '8px' }}
                            >
                                <div style={{ flex: 1 }}>
                                    <div className="font-bold flex items-center gap-6">
                                        <span style={{ color: 'var(--text-main)' }}>{supp ? supp.name : 'Integratore eliminato'}</span>
                                        <span style={{ fontSize: '0.75rem' }}>💊</span>
                                    </div>
                                    <div className="text-muted text-sm mt-2">
                                        {intake.amount} {supp ? supp.unit : 'g'} • {timeStr}
                                    </div>
                                </div>
                                <button 
                                    type="button"
                                    className="btn-icon text-danger" 
                                    onClick={() => removeIntake(intake.id)}
                                    aria-label="Rimuovi integratore"
                                >
                                    ✕
                                </button>
                            </div>
                        );
                    })}
                </div>
            )}


        </div>
    );
}
