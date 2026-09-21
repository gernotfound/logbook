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
        <div className="tracking-stack">
            {setSelectedDate && (
                <NutritionDateNavigator
                    targetDateStr={targetDateStr}
                    onPrevious={handlePrevDay}
                    onNext={handleNextDay}
                    onToday={handleToday}
                />
            )}

            <section className="tracking-panel" aria-label="Riepilogo alimentazione">
                <div className="tracking-row tracking-row--wrap mb-15">
                    <h2 className={`tracking-heading ${isDayOn ? 'tracking-accent' : ''}`}>
                        {isDayOn ? 'Giorno ON' : 'Giorno OFF'}
                    </h2>
                    <button
                        type="button"
                        className="btn btn-secondary"
                        onClick={async () => {
                            const confirmed = await showConfirm(`Sei sicuro di voler cambiare il giorno in ${isDayOn ? 'OFF' : 'ON'}?`);
                            if (confirmed) {
                                setDayType(!isDayOn);
                            }
                        }}
                    >
                        Cambia giorno
                    </button>
                </div>

                <div className="tracking-row mb-15">
                    <div>
                        <strong className="nutrition-calorie-value">{Math.round(todayNutrition.kcal)}</strong>
                        <span className="tracking-muted text-sm block">kcal assunte</span>
                    </div>
                    <div className="text-right">
                        <strong>{dailyTarget.kcal || 0}</strong>
                        <span className="tracking-muted text-sm block">Obiettivo kcal</span>
                    </div>
                </div>

                <div className="progress-bg mb-15" aria-hidden="true">
                    <div className="progress-fill" style={{ width: `${dailyTarget.kcal > 0 ? Math.min((todayNutrition.kcal / dailyTarget.kcal) * 100, 100) : 0}%` }} />
                </div>

                <dl className="tracking-metrics tracking-metrics--three">
                    <div><dt>Proteine</dt><dd>{Math.round(todayNutrition.pro)}<span className="text-sm tracking-muted"> / {dailyTarget.pro} g</span></dd></div>
                    <div><dt>Carboidrati</dt><dd>{Math.round(todayNutrition.carbs)}<span className="text-sm tracking-muted"> / {dailyTarget.carbs} g</span></dd></div>
                    <div><dt>Grassi</dt><dd>{Math.round(todayNutrition.fat)}<span className="text-sm tracking-muted"> / {dailyTarget.fat} g</span></dd></div>
                </dl>
            </section>

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
