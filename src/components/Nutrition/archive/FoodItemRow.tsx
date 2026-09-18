import React from 'react';
import { Pencil, Copy, Trash2 } from 'lucide-react';
import { ContextMenu } from '../../UI/ContextMenu';

interface FoodItemRowProps {
    food: any;
    isLast: boolean;
    mealTypes: string[];
    onEdit: (food: any) => void;
    onDelete: (food: any) => void;
    onDuplicate: (food: any) => void;
    onQuickAddToMeal: (food: any, mealType: string) => void;
}

export const FoodItemRow: React.FC<FoodItemRowProps> = ({
    food,
    isLast,
    mealTypes,
    onEdit,
    onDelete,
    onDuplicate,
    onQuickAddToMeal
}) => {
    return (
        <div
            style={{
                padding: '14px 0',
                borderBottom: isLast ? 'none' : '1px solid var(--glass-border)',
                display: 'flex',
                flexDirection: 'column',
                gap: '8px'
            }}
        >
            <div className="tracking-row">
                <div>
                    <div style={{ fontWeight: 'bold',  color: 'var(--text-main)', display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap' }} className="text-base">
                        <span>{food.name}</span>
                    </div>
                    {food.brand && (
                        <div style={{  color: 'var(--text-muted)', marginTop: '2px' }} className="text-sm">
                            {food.brand}
                        </div>
                    )}
                </div>

                <div style={{ display: 'flex', gap: '6px', flexShrink: 0 }}>
                    <ContextMenu
                        items={[
                            {
                                label: 'Modifica',
                                icon: <Pencil size={16} />,
                                onClick: () => onEdit(food)
                            },
                            {
                                label: 'Duplica',
                                icon: <Copy size={16} />,
                                onClick: () => onDuplicate(food)
                            },
                            {
                                label: 'Elimina',
                                icon: <Trash2 size={16} />,
                                variant: 'danger',
                                onClick: () => onDelete(food)
                            }
                        ]}
                    />
                </div>
            </div>

            {/* Macro details */}
            <div style={{ display: 'flex', alignItems: 'center', gap: '12px',  color: 'var(--text-muted)', flexWrap: 'wrap' }} className="text-sm">
                <span style={{ fontWeight: 'bold', color: 'var(--text-main)' }}>
                    {food.kcal} kcal
                </span>
                <span>/ {food.baseQty || 100}{food.unit || 'g'}</span>
                <span>•</span>
                <span>Pro: <b style={{ color: 'var(--text-main)' }}>{food.pro || 0}g</b></span>
                <span>Carbo: <b style={{ color: 'var(--text-main)' }}>{food.carbs || 0}g</b></span>
                <span>Grassi: <b style={{ color: 'var(--text-main)' }}>{food.fat || 0}g</b></span>
            </div>

            {/* Quick Add buttons */}
            <div className="tracking-quick-meals">
                {mealTypes.map(mt => (
                    <button
                        key={mt}
                        type="button"
                        className="btn btn-secondary" aria-label={`Aggiungi ${food.name} a ${mt}`}
                        onClick={() => onQuickAddToMeal(food, mt)}
                    >
                        {mt}
                    </button>
                ))}
            </div>
        </div>
    );
};


