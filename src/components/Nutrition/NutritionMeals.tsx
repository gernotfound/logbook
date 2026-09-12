import { useState } from 'react';
import { ChevronLeft, ChevronRight, Flame, Pencil, Pill, Plus, Search, Trash2, X } from 'lucide-react';
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

const progressPercent = (value: number, target: number) => target > 0 ? Math.min((value / target) * 100, 100) : 0;

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
    const showConfirm = useDialogStore(state => state.showConfirm);
    const [editingMealItem, setEditingMealItem] = useState<any | null>(null);
    const today = Logic.getLocalDateString();

    const handlePrevDay = () => {
        if (!setSelectedDate || !targetDateStr) return;
        setSelectedDate(shiftDateString(targetDateStr, -1));
    };

    const handleNextDay = () => {
        if (!setSelectedDate || !targetDateStr || targetDateStr === today) return;
        setSelectedDate(shiftDateString(targetDateStr, 1));
    };

    const handleToday = () => {
        if (setSelectedDate) setSelectedDate(today);
    };

    const handleToggleDay = async () => {
        const confirmed = await showConfirm(`Sei sicuro di voler cambiare il giorno in ${isDayOn ? 'OFF' : 'ON'}?`);
        if (confirmed) setDayType(!isDayOn);
    };

    return (
        <div className="nutrition-diary">
            {setSelectedDate && (
                <div className="nutrition-date-nav" aria-label="Navigazione giorno nutrizionale">
                    <button type="button" onClick={handlePrevDay} aria-label="Giorno precedente"><ChevronLeft size={18} /></button>
                    <button type="button" className="nutrition-date-nav__current" onClick={handleToday} title="Torna a oggi">
                        <strong>{Logic.formatItalianDate ? Logic.formatItalianDate(targetDateStr || '') : targetDateStr}</strong>
                        {targetDateStr === today && <small>Oggi</small>}
                    </button>
                    <button type="button" onClick={handleNextDay} disabled={targetDateStr === today} aria-label="Giorno successivo"><ChevronRight size={18} /></button>
                </div>
            )}

            <section className="nutrition-summary">
                <div className="nutrition-summary__topline">
                    <div className={`day-type-badge ${isDayOn ? 'is-on' : 'is-off'}`}>
                        <Flame size={16} aria-hidden="true" />
                        <span>Giorno {isDayOn ? 'ON' : 'OFF'}</span>
                    </div>
                    <button type="button" className="btn btn-small btn-secondary nutrition-summary__switch" onClick={handleToggleDay}>Cambia giorno</button>
                </div>

                <div className="nutrition-kcal-hero">
                    <div>
                        <strong>{Math.round(todayNutrition.kcal)}</strong>
                        <span>kcal assunte</span>
                    </div>
                    <div className="nutrition-kcal-hero__target">
                        <strong style={{ color: 'var(--text-main)' }}>{dailyTarget.kcal || 0}</strong>
                        <span>target</span>
                    </div>
                </div>

                <div className="nutrition-progress nutrition-progress--kcal" aria-label="Progresso calorie">
                    <span style={{ width: `${progressPercent(todayNutrition.kcal, dailyTarget.kcal)}%` }} />
                </div>

                <div className="macro-grid">
                    <div className="macro-card macro-card--protein">
                        <span className="macro-card__label" style={{ color: 'var(--text-muted)' }}>PRO</span>
                        <strong>{Math.round(todayNutrition.pro)}<small> / {dailyTarget.pro} g</small></strong>
                        <div className="nutrition-progress"><span style={{ width: `${progressPercent(todayNutrition.pro, dailyTarget.pro)}%` }} /></div>
                    </div>
                    <div className="macro-card macro-card--carbs">
                        <span className="macro-card__label" style={{ color: 'var(--text-muted)' }}>CAR</span>
                        <strong>{Math.round(todayNutrition.carbs)}<small> / {dailyTarget.carbs} g</small></strong>
                        <div className="nutrition-progress"><span style={{ width: `${progressPercent(todayNutrition.carbs, dailyTarget.carbs)}%` }} /></div>
                    </div>
                    <div className="macro-card macro-card--fat">
                        <span className="macro-card__label" style={{ color: 'var(--text-muted)' }}>GRA</span>
                        <strong>{Math.round(todayNutrition.fat)}<small> / {dailyTarget.fat} g</small></strong>
                        <div className="nutrition-progress"><span style={{ width: `${progressPercent(todayNutrition.fat, dailyTarget.fat)}%` }} /></div>
                    </div>
                </div>
            </section>

            <section className="nutrition-search-surface">
                <header className="nutrition-section-heading">
                    <div>
                        <span className="page-header__eyebrow">Diario alimentare</span>
                        <h2 style={{ color: 'var(--text-main)' }}>Cerca alimento</h2>
                    </div>
                </header>

                <label className="search-field nutrition-food-search">
                    <Search size={18} aria-hidden="true" />
                    <input
                        type="text"
                        placeholder="Cerca alimento (es. Pollo, Riso, Avena...)"
                        value={searchQuery}
                        onChange={event => handleSearch(event.target.value)}
                        onFocus={event => event.target.select()}
                    />
                    {searchQuery && (
                        <button type="button" className="nutrition-search-clear" onClick={clearSearch} aria-label="Cancella ricerca"><X size={17} /></button>
                    )}
                </label>

                {searchResults.length > 0 && (
                    <div id="active-search-results" className="food-search-results">
                        {searchResults.map((food: any, index: number) => (
                            <div key={food.id || index} className="food-search-result">
                                <div className="food-search-result__info">
                                    <div className="food-search-result__title">
                                        <strong>{food.name}</strong>
                                        {food.isCustom && <span>Custom</span>}
                                    </div>
                                    <p>{food.kcal} kcal / {food.baseQty || 100}{food.unit || 'g'} · P {food.pro || 0}g · C {food.carbs || 0}g · G {food.fat || 0}g</p>
                                </div>
                                <div className="food-search-result__actions" aria-label={`Aggiungi ${food.name} a un pasto`}>
                                    {MEAL_TYPES.map(mealType => (
                                        <button key={mealType} type="button" onClick={() => addFood(food, mealType)} title={`Aggiungi a ${mealType}`}>
                                            {mealType.substring(0, 3)}
                                        </button>
                                    ))}
                                </div>
                            </div>
                        ))}
                    </div>
                )}

                {searchQuery.trim().length >= 2 && searchResults.length === 0 && (
                    <div className="nutrition-empty-search">Nessun alimento trovato. Puoi crearlo subito qui sotto.</div>
                )}

                <button
                    type="button"
                    className={`btn ${showCustomModal ? 'btn-secondary' : 'btn-primary'} nutrition-create-food`}
                    onClick={() => {
                        if (showCustomModal) cancelCustomFood();
                        else setShowCustomModal(true);
                    }}
                >
                    {showCustomModal ? <><X size={17} /> Chiudi</> : <><Plus size={17} /> {editingFoodId ? 'Modifica alimento' : 'Crea alimento'}</>}
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

            <div className="meal-section-list">
                {MEAL_TYPES.map(mealType => {
                    const mealItems = meals.filter(meal => meal.meal === mealType);
                    let subKcal = 0, subC = 0, subP = 0, subF = 0;
                    mealItems.forEach(meal => {
                        const base = meal.baseQty !== undefined && meal.baseQty !== null && meal.baseQty > 0
                            ? meal.baseQty
                            : (meal.unit === 'porzione' || meal.meal === 'quick' ? 1 : 100);
                        const qty = meal.quantity !== undefined && meal.quantity !== null ? meal.quantity : base;
                        const ratio = base > 0 ? qty / base : 1;
                        subKcal += (parseFloat(meal.kcal) || 0) * ratio;
                        subC += (parseFloat(meal.carbs) || 0) * ratio;
                        subP += (parseFloat(meal.pro) || 0) * ratio;
                        subF += (parseFloat(meal.fat) || 0) * ratio;
                    });

                    return (
                        <section key={mealType} className="meal-section">
                            <header className="meal-section__header">
                                <h2 style={{ color: 'var(--text-main)' }}>{mealType}</h2>
                                <div>
                                    <strong>{Math.round(subKcal)} kcal</strong>
                                    <span>P {Math.round(subP)} · C {Math.round(subC)} · G {Math.round(subF)}</span>
                                </div>
                            </header>

                            {mealItems.length === 0 ? (
                                <div className="meal-section__empty">Nessun alimento aggiunto.</div>
                            ) : (
                                <div className="meal-item-list">
                                    {mealItems.map(item => {
                                        const base = item.baseQty !== undefined && item.baseQty !== null && item.baseQty > 0
                                            ? item.baseQty
                                            : (item.unit === 'porzione' || item.meal === 'quick' ? 1 : 100);
                                        const qty = item.quantity !== undefined && item.quantity !== null ? item.quantity : base;
                                        const ratio = base > 0 ? qty / base : 1;
                                        const itemKcal = Math.round((parseFloat(item.kcal) || 0) * ratio);
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
                                            <div key={item.time || item.id} className="meal-item" onClick={() => setEditingMealItem(item)} title="Clicca per modificare la porzione">
                                                <div className="meal-item__info">
                                                    <div className="meal-item__name"><span>{item.name}</span><Pencil size={13} aria-hidden="true" /></div>
                                                    <span>{qty}{item.unit || 'g'} · {itemKcal} kcal</span>
                                                </div>
                                                <button
                                                    type="button"
                                                    className="meal-item__remove"
                                                    onClick={event => {
                                                        event.stopPropagation();
                                                        removeFood(item.itemId || item.time || item.id);
                                                    }}
                                                    aria-label="Rimuovi alimento"
                                                >
                                                    <Trash2 size={17} aria-hidden="true" />
                                                </button>
                                            </div>
                                        );
                                    })}
                                </div>
                            )}
                        </section>
                    );
                })}
            </div>

            {todayNutrition?.supplementsIntake && todayNutrition.supplementsIntake.length > 0 && (
                <section className="meal-section supplement-intake-section">
                    <header className="meal-section__header">
                        <div className="supplement-section-title"><Pill size={18} aria-hidden="true" /><h2 style={{ color: 'var(--text-main)' }}>Integratori</h2></div>
                        <div><strong>{todayNutrition.supplementsIntake.length}</strong><span>assunzioni</span></div>
                    </header>
                    <div className="meal-item-list">
                        {todayNutrition.supplementsIntake.map((intake: any) => {
                            const supplement = supplementsLibrary.find(item => item.id === intake.supplementId);
                            const timeStr = new Date(intake.time).toLocaleTimeString('it-IT', { hour: '2-digit', minute: '2-digit' });
                            return (
                                <div key={intake.id} className="meal-item meal-item--static">
                                    <div className="meal-item__info">
                                        <div className="meal-item__name"><span>{supplement ? supplement.name : 'Integratore eliminato'}</span></div>
                                        <span>{intake.amount} {supplement ? supplement.unit : 'g'} · {timeStr}</span>
                                    </div>
                                    <button type="button" className="meal-item__remove" onClick={() => removeIntake(intake.id)} aria-label="Rimuovi integratore">
                                        <Trash2 size={17} aria-hidden="true" />
                                    </button>
                                </div>
                            );
                        })}
                    </div>
                </section>
            )}
        </div>
    );
}
