import { useId, useState } from 'react';
import { DayNavigator } from './DayNavigator';
import './TrackingViews.css';
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
    const searchId = useId();
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
            {setSelectedDate && <DayNavigator date={targetDateStr || ''} today={Logic.getLocalDateString()} onPrevious={handlePrevDay} onNext={handleNextDay} onToday={handleToday} />}

            <section className="tracking-panel" aria-label="Riepilogo alimentazione">
                <div className="tracking-row tracking-row--wrap mb-15">
                    <h2 className="tracking-heading">{isDayOn ? 'Giorno ON' : 'Giorno OFF'}</h2>
                    <button type="button" className="btn btn-secondary" onClick={async () => {
                        const confirmed = await showConfirm(`Sei sicuro di voler cambiare il giorno in ${isDayOn ? 'OFF' : 'ON'}?`);
                        if (confirmed) setDayType(!isDayOn);
                    }}>Cambia giorno</button>
                </div>
                <div className="tracking-row mb-15">
                    <div><strong className="nutrition-calorie-value">{Math.round(todayNutrition.kcal)}</strong><span className="tracking-muted text-sm block">kcal assunte</span></div>
                    <div className="text-right"><strong>{dailyTarget.kcal || 0}</strong><span className="tracking-muted text-sm block">Obiettivo kcal</span></div>
                </div>
                <div className="progress-bg mb-15" aria-hidden="true"><div className="progress-fill" style={{ width: `${dailyTarget.kcal > 0 ? Math.min((todayNutrition.kcal / dailyTarget.kcal) * 100, 100) : 0}%` }} /></div>
                <dl className="tracking-metrics tracking-metrics--three">
                    <div><dt>Proteine</dt><dd>{Math.round(todayNutrition.pro)}<span className="text-sm tracking-muted"> / {dailyTarget.pro} g</span></dd></div>
                    <div><dt>Carboidrati</dt><dd>{Math.round(todayNutrition.carbs)}<span className="text-sm tracking-muted"> / {dailyTarget.carbs} g</span></dd></div>
                    <div><dt>Grassi</dt><dd>{Math.round(todayNutrition.fat)}<span className="text-sm tracking-muted"> / {dailyTarget.fat} g</span></dd></div>
                </dl>
            </section>

            <section className="tracking-panel" aria-labelledby={`${searchId}-heading`}>
                <h2 id={`${searchId}-heading`} className="tracking-heading">Cerca alimento</h2>
                <label htmlFor={searchId} className="sr-only">Cerca alimento</label>
                <div className="tracking-search">
                    <input id={searchId} type="search" placeholder="Cerca alimento (es. Pollo, Riso, Avena...)" value={searchQuery} onChange={e => handleSearch(e.target.value)} onFocus={e => e.target.select()} />
                    {searchQuery && <button type="button" className="btn-icon" onClick={clearSearch} aria-label="Cancella ricerca"><X size={20} aria-hidden="true" /></button>}
                </div>
                {searchResults.length > 0 && <div id="active-search-results" className="tracking-search-results" aria-label="Alimenti trovati">
                    {searchResults.map((f: any, idx: number) => <div key={f.id || idx} className="tracking-food-result">
                        <div className="tracking-row tracking-row--wrap"><strong>{f.name}</strong>{f.isCustom && <span className="tracking-badge">Personalizzato</span>}</div>
                        <p className="tracking-muted text-sm mt-4">{f.kcal} kcal / {f.baseQty || 100}{f.unit || 'g'} • P:{f.pro || 0}g C:{f.carbs || 0}g G:{f.fat || 0}g</p>
                        <div className="tracking-quick-meals">
                            {MEAL_TYPES.map(mt => <button key={mt} type="button" className="btn btn-secondary" onClick={() => addFood(f, mt)} title={`Aggiungi a ${mt}`} aria-label={`Aggiungi ${f.name} a ${mt}`}>{mt}</button>)}
                        </div>
                    </div>)}
                </div>}
                {searchQuery.trim().length >= 2 && searchResults.length === 0 && <p className="tracking-empty" role="status">Nessun alimento trovato. Puoi crearlo subito con <b>+ Crea alimento</b>.</p>}
                <button type="button" className="btn btn-primary tracking-full-button" onClick={() => {
                    if (showCustomModal) cancelCustomFood();
                    else setShowCustomModal(true);
                }}>
                    {showCustomModal ? <><X size={20} aria-hidden="true" /> Chiudi</> : (editingFoodId ? <><Pencil size={20} aria-hidden="true" /> Modifica alimento</> : <><Plus size={20} aria-hidden="true" /> Crea alimento</>)}
                </button>
                <CustomFoodForm cfData={cfData} setCfData={setCfData} saveCustomFood={saveCustomFood} showCustomModal={showCustomModal} setShowCustomModal={setShowCustomModal} isEditing={!!editingFoodId} onCancel={cancelCustomFood} />
            </section>

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
                                        className="tracking-meal-row"
                                    >
                                        <button type="button" className="tracking-meal-open" onClick={() => setEditingMealItem(item)} aria-label={`Modifica porzione di ${item.name}`}>
                                            <span className="font-bold flex items-center gap-6">
                                                <span>{item.name}</span>
                                                <Pencil size={16} aria-hidden="true" />
                                            </span>
                                            <span className="text-muted text-sm mt-2">
                                                {qty}{item.unit || 'g'} • {itemKcal} kcal
                                            </span>
                                        </button>
                                        <button
                                            type="button"
                                            className="btn-icon text-danger"
                                            onClick={(e) => {
                                                e.stopPropagation();
                                                removeFood(item.time ?? item.id);
                                            }}
                                            aria-label={`Rimuovi ${item.name}`}
                                        >
                                            <X size={20} aria-hidden="true" />
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
                                    <X size={20} aria-hidden="true" />
                                </button>
                            </div>
                        );
                    })}
                </div>
            )}


        </div>
    );
}
