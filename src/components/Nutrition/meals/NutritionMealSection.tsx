import { Pencil } from 'lucide-react';
import type { LoggedMealItem } from '../../../types';
import type { useNutritionMeals } from '../../../hooks/useNutritionMeals';
import InlineEditMealItem from '../InlineEditMealItem';
import { calculateRawLoggedMealTotals, getLoggedMealPortion } from '../../../lib/nutrition/calculateLoggedMealTotals';

type NutritionMealsHook = ReturnType<typeof useNutritionMeals>;

interface NutritionMealSectionProps {
    mealType: string;
    mealItems: LoggedMealItem[];
    editingMealItem: LoggedMealItem | null;
    onEditingMealItemChange: (item: LoggedMealItem | null) => void;
    onUpdateMealItem: NutritionMealsHook['updateMealItem'];
    onRemoveFood: NutritionMealsHook['removeFood'];
}

export function NutritionMealSection({
    mealType,
    mealItems,
    editingMealItem,
    onEditingMealItemChange,
    onUpdateMealItem,
    onRemoveFood,
}: NutritionMealSectionProps) {
    const totals = calculateRawLoggedMealTotals(mealItems);

    return (
        <section className="tracking-panel">
            <div className="tracking-row tracking-row--wrap mb-10 pb-10 border-b">
                <h2 className="tracking-heading">{mealType}</h2>
                <span className="text-sm text-muted">
                    {Math.round(totals.kcal)} kcal • P:{Math.round(totals.pro)} C:{Math.round(totals.carbs)} G:{Math.round(totals.fat)}
                </span>
            </div>

            {mealItems.length === 0 ? (
                <p className="text-muted text-center my-10 text-sm">Nessun alimento aggiunto.</p>
            ) : (
                mealItems.map(item => {
                    const { quantity: qty, ratio } = getLoggedMealPortion(item);
                    const itemKcal = Math.round((Number(item.kcal) || 0) * ratio);
                    const isEditing = editingMealItem && (editingMealItem.time === item.time || editingMealItem.id === item.id);

                    if (isEditing) {
                        return (
                            <InlineEditMealItem
                                key={`edit-${item.time || item.id}`}
                                item={editingMealItem}
                                onClose={() => onEditingMealItemChange(null)}
                                onSave={onUpdateMealItem}
                                onDelete={onRemoveFood}
                            />
                        );
                    }

                    return (
                        <div
                            key={item.time || item.id}
                            className="tracking-meal-row"
                        >
                            <button type="button" className="tracking-meal-open" onClick={() => onEditingMealItemChange(item)} aria-label={`Modifica porzione di ${item.name}`}>
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
                                onClick={(event) => {
                                    event.stopPropagation();
                                    void onRemoveFood(item.time ?? item.id).catch(error => console.error('Rimozione alimento non completata:', error));
                                }}
                                aria-label={`Rimuovi ${item.name}`}
                            >
                                ✕
                            </button>
                        </div>
                    );
                })
            )}
        </section>
    );
}
