import React from 'react';

interface FoodItemRowProps {
    food: any;
    isLast: boolean;
    mealTypes: string[];
    onEdit: (food: any) => void;
    onDelete: (food: any) => void;
    onQuickAddToMeal: (food: any, mealType: string) => void;
}

export const FoodItemRow: React.FC<FoodItemRowProps> = ({
    food,
    isLast,
    mealTypes,
    onEdit,
    onDelete,
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
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: '10px' }}>
                <div>
                    <div style={{ fontWeight: 'bold', fontSize: '1rem', color: 'var(--text-main)', display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap' }}>
                        <span>{food.name}</span>
                    </div>
                    {food.brand && (
                        <div style={{ fontSize: '0.8rem', color: 'var(--text-muted)', marginTop: '2px' }}>
                            {food.brand}
                        </div>
                    )}
                </div>

                <div style={{ display: 'flex', gap: '6px', flexShrink: 0 }}>
                    <button 
                        type="button" 
                        className="btn btn-small" 
                        style={{ padding: '4px 8px', fontSize: '0.8rem', background: 'rgba(255,255,255,0.08)', marginBottom: 0 }}
                        onClick={() => onEdit(food)}
                        title="Modifica alimento"
                    >
                        ✏️ Modifica
                    </button>
                    <button 
                        type="button" 
                        className="btn-icon" 
                        style={{ color: 'var(--danger-color)', fontSize: '0.9rem' }}
                        onClick={() => onDelete(food)}
                        title="Elimina alimento"
                    >
                        🗑️
                    </button>
                </div>
            </div>

            {/* Macro details */}
            <div style={{ display: 'flex', alignItems: 'center', gap: '12px', fontSize: '0.85rem', color: 'var(--text-muted)', flexWrap: 'wrap' }}>
                <span style={{ fontWeight: 'bold', color: 'var(--warning-color)' }}>
                    {food.kcal} kcal
                </span>
                <span>/ {food.baseQty || 100}{food.unit || 'g'}</span>
                <span>•</span>
                <span>Carbo: <b style={{ color: 'var(--text-main)' }}>{food.carbs || 0}g</b></span>
                <span>Pro: <b style={{ color: 'var(--text-main)' }}>{food.pro || 0}g</b></span>
                <span>Grassi: <b style={{ color: 'var(--text-main)' }}>{food.fat || 0}g</b></span>
            </div>

            {/* Quick Add buttons */}
            <div style={{ display: 'flex', alignItems: 'center', gap: '6px', marginTop: '4px' }}>
                <span style={{ fontSize: '0.75rem', color: 'var(--text-muted)', marginRight: '4px' }}>+ Aggiungi a:</span>
                {mealTypes.map(mt => (
                    <button 
                        key={mt}
                        type="button"
                        className="btn btn-small"
                        style={{ 
                            padding: '4px 8px', 
                            fontSize: '0.75rem', 
                            marginBottom: 0,
                            background: 'rgba(255,255,255,0.06)',
                            border: '1px solid var(--glass-border)',
                            color: 'var(--text-main)'
                        }}
                        onClick={() => onQuickAddToMeal(food, mt)}
                    >
                        {mt}
                    </button>
                ))}
            </div>
        </div>
    );
};
