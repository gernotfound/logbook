import { Pencil } from 'lucide-react';
import type { LoggedMealItem } from '../../../types';
import type { useNutritionMeals } from '../../../hooks/useNutritionMeals';
import InlineEditMealItem from '../InlineEditMealItem';

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
    let subKcal = 0;
    let subC = 0;
    let subP = 0;
    let subF = 0;

    mealItems.forEach(item => {
        const base = item.baseQty !== undefined && item.baseQty !== null && item.baseQty > 0
            ? item.baseQty
            : (item.unit === 'porzione' || item.meal === 'quick' ? 1 : 100);
        const qty = item.quantity !== undefined && item.quantity !== null
            ? item.quantity
            : base;
        const ratio = base > 0 ? qty / base : 1;
        subKcal += (Number(item.kcal) || 0) * ratio;
        subC += (Number(item.carbs) || 0) * ratio;
        subP += (Number(item.pro) || 0) * ratio;
        subF += (Number(item.fat) || 0) * ratio;
    });

    return (
        <div className="section-divider">
            <div className="flex-between mb-10 pb-10 border-b">
                <h2 className="m-0" style={{color: 'var(--text-main)'}}>{mealType}</h2>
                <span className="text-sm text-muted">
                    {Math.round(subKcal)} kcal • P:{Math.round(subP)} C:{Math.round(subC)} G:{Math.round(subF)}
                </span>
            </div>

            {mealItems.length === 0 ? (
                <p className="text-muted text-center my-10 text-sm">Nessun alimento aggiunto.</p>
            ) : (
                mealItems.map(item => {
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
                                onClose={() => onEditingMealItemChange(null)}
                                onSave={onUpdateMealItem}
                                onDelete={onRemoveFood}
                            />
                        );
                    }

                    return (
                        <div
                            key={item.time || item.id}
                            className="flex-between py-10 border-b-dashed"
                            style={{ cursor: 'pointer', transition: 'background 0.2s', padding: '10px 6px', borderRadius: '8px' }}
                            onClick={() => onEditingMealItemChange(item)}
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
                                onClick={(event) => {
                                    event.stopPropagation();
                                    onRemoveFood(item.time ?? item.id);
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
}
