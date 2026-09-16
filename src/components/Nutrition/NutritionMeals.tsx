import { useState } from 'react';
import { shiftDateString } from '../../lib/utils/date';
import { useNutritionMeals } from '../../hooks/useNutritionMeals';
import { useDialogStore } from '../../store/useDialogStore';
import { useSupplements } from '../../hooks/useSupplements';
import { Logic } from '../../lib/logic';
import type { LoggedMealItem } from '../../types';
import { NutritionDateNavigator } from './meals/NutritionDateNavigator';
import { NutritionFoodSearch } from './meals/NutritionFoodSearch';
import { NutritionMealSection } from './meals/NutritionMealSection';
import { NutritionSupplementIntakes } from './meals/NutritionSupplementIntakes';

const MEAL_TYPES = ['Colazione', 'Pranzo', 'Cena', 'Spuntini'] as const;

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
    const showConfirm = useDialogStore(state => state.showConfirm);
    const [editingMealItem, setEditingMealItem] = useState<LoggedMealItem | null>(null);

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
            {setSelectedDate && (
                <NutritionDateNavigator
                    targetDateStr={targetDateStr}
                    onPrevious={handlePrevDay}
                    onNext={handleNextDay}
                    onToday={handleToday}
                />
            )}

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

            <NutritionFoodSearch
                mealTypes={MEAL_TYPES}
                searchQuery={searchQuery}
                handleSearch={handleSearch}
                searchResults={searchResults}
                clearSearch={clearSearch}
                showCustomModal={showCustomModal}
                setShowCustomModal={setShowCustomModal}
                editingFoodId={editingFoodId}
                cancelCustomFood={cancelCustomFood}
                cfData={cfData}
                setCfData={setCfData}
                saveCustomFood={saveCustomFood}
                addFood={addFood}
            />

            {MEAL_TYPES.map(mealType => (
                <NutritionMealSection
                    key={mealType}
                    mealType={mealType}
                    mealItems={meals.filter(meal => meal.meal === mealType)}
                    editingMealItem={editingMealItem}
                    onEditingMealItemChange={setEditingMealItem}
                    onUpdateMealItem={updateMealItem}
                    onRemoveFood={removeFood}
                />
            ))}

            <NutritionSupplementIntakes
                intakes={todayNutrition.supplementsIntake || []}
                supplementsLibrary={supplementsLibrary}
                onRemoveIntake={removeIntake}
            />
        </div>
    );
}
