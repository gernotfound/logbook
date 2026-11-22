import { useState } from 'react';
import type { CaptureNutritionSession, useNutritionMealEditor } from '../../hooks/useNutritionMealEditor';
import { useDialogStore } from '../../store/useDialogStore';
import type { LoggedMealItem, Supplement } from '../../types';
import { NutritionDateNavigator } from './meals/NutritionDateNavigator';
import { NutritionFoodSearch } from './meals/NutritionFoodSearch';
import { NutritionMealSection } from './meals/NutritionMealSection';
import { NutritionSupplementIntakes } from './meals/NutritionSupplementIntakes';

const MEAL_TYPES = ['Colazione', 'Pranzo', 'Cena', 'Spuntini'] as const;

export function NutritionMealsForm({
    hook, dataOwner, capture, supplementsLibrary, removeIntake, setSelectedDate,
}: {
    hook: ReturnType<typeof useNutritionMealEditor>;
    dataOwner: string | null;
    capture: CaptureNutritionSession;
    supplementsLibrary: Supplement[];
    removeIntake: (id: string) => Promise<void>;
    setSelectedDate?: (date: string) => void;
}) {
    const {
        todayNutrition, dailyTarget, isDayOn, setDayType,
        searchQuery, handleSearch, searchResults, clearSearch,
        showCustomModal, setShowCustomModal,
        editingFoodId, cancelCustomFood,
        cfData, setCfData, saveCustomFood,
        meals, addFood, removeFood, updateMealItem, targetDateStr
    } = hook;

    const showConfirm = useDialogStore(state => state.showConfirm);
    const [editContext, setEditContext] = useState<{
        owner: string | null; date: string; item: LoggedMealItem;
    } | null>(null);
    const editingMealItem = editContext !== null && editContext.owner === dataOwner && editContext.date === targetDateStr
        ? editContext.item : null;
    const setEditingMealItem = (item: LoggedMealItem | null) => {
        setEditContext(item ? { owner: dataOwner, date: targetDateStr, item } : null);
    };
    const visibleMealItems = (type: string) => {
        const visible = meals.filter(item => item.meal === type
            && (editingMealItem?.id !== item.id || editingMealItem.meal === type));
        // Anchor the editor while an optimistic commit moves its record to a
        // different group, so a rejected commit cannot unmount its draft.
        if (editingMealItem?.meal === type && !visible.some(item => item.id === editingMealItem.id)) {
            return [...visible, editingMealItem];
        }
        return visible;
    };

    return (
        <div className="tracking-stack">
            {setSelectedDate && (
                <NutritionDateNavigator
                    targetDateStr={targetDateStr}
                    setSelectedDate={setSelectedDate}
                />
            )}

            <section className="tracking-panel" aria-label="Riepilogo alimentazione">
                <div className="tracking-row tracking-row--wrap mb-15">
                    <h2 className={`tracking-heading ${isDayOn === true ? 'tracking-accent' : ''}`}>
                        {isDayOn === true ? 'Giorno ON' : isDayOn === false ? 'Giorno OFF' : 'Giorno non specificato'}
                    </h2>
                    <div className="tracking-row" role="group" aria-label="Tipo di giornata">
                        {([
                            { label: 'ON', value: true },
                            { label: 'OFF', value: false },
                            { label: 'Non specificato', value: undefined },
                        ] as const).map(option => (
                            <button
                                key={option.label}
                                type="button"
                                className="btn btn-secondary"
                                aria-pressed={isDayOn === option.value}
                                onClick={async () => {
                                    if (isDayOn === option.value) return;
                                    // A confirmation may outlive its owner or the original Auth epoch.
                                    const session = capture();
                                    if (!session?.isCurrent()) return;
                                    const needsConfirm = isDayOn !== undefined;
                                    if (needsConfirm && !(await showConfirm(`Sei sicuro di voler cambiare il giorno in ${option.label}?`))) return;
                                    if (!session.isCurrent()) return;
                                    await setDayType(option.value);
                                }}
                            >
                                {option.label}
                            </button>
                        ))}
                    </div>
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
                    mealItems={visibleMealItems(mealType)}
                    editingMealItem={editingMealItem}
                    onEditingMealItemChange={setEditingMealItem}
                    onUpdateMealItem={updateMealItem}
                    onRemoveFood={removeFood}
                />
            ))}
            {(meals.some(meal => meal.meal === 'quick') || editingMealItem?.meal === 'quick') && (
                <NutritionMealSection
                    mealType="Aggiunte rapide"
                    mealItems={visibleMealItems('quick')}
                    editingMealItem={editingMealItem}
                    onEditingMealItemChange={setEditingMealItem}
                    onUpdateMealItem={updateMealItem}
                    onRemoveFood={removeFood}
                />
            )}

            <NutritionSupplementIntakes
                intakes={todayNutrition.supplementsIntake || []}
                supplementsLibrary={supplementsLibrary}
                onRemoveIntake={removeIntake}
            />
        </div>
    );
}
