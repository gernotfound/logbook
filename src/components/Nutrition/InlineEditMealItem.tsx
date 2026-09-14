import { useState } from 'react';
import { Pencil, Trash2, Save } from 'lucide-react';

interface EditMealItemModalProps {
    item: any;
    onClose: () => void;
    onSave: (updatedItem: any) => void;
    onDelete: (itemId: number | string) => void;
}

const MEAL_TYPES = ['Colazione', 'Pranzo', 'Cena', 'Spuntini'];

export default function EditMealItemModal({ item, onClose, onSave, onDelete }: EditMealItemModalProps) {
    const [quantity, setQuantity] = useState<number | string>(item.quantity ?? item.baseQty ?? 100);
    const [meal, setMeal] = useState<string>(item.meal || 'Colazione');

    const base = item.baseQty ?? 100;
    const numQty = parseFloat(quantity as string) || 0;
    const ratio = base > 0 ? numQty / base : 1;

    const currentKcal = Math.round((parseFloat(item.kcal) || 0) * ratio);
    const currentCarbs = Math.round((parseFloat(item.carbs) || 0) * ratio * 10) / 10;
    const currentPro = Math.round((parseFloat(item.pro) || 0) * ratio * 10) / 10;
    const currentFat = Math.round((parseFloat(item.fat) || 0) * ratio * 10) / 10;

    const handleSave = () => {
        onSave({
            ...item,
            quantity: numQty,
            meal
        });
        onClose();
    };

    const handleDelete = () => {
        onDelete(item.time || item.id);
        onClose();
    };

    return (
        <div 
            className="card"
            style={{
                background: 'var(--surface-color)',
                border: '1px solid var(--primary-color)',
                borderRadius: '12px',
                padding: '15px',
                marginTop: '5px',
                marginBottom: '15px',
                animation: 'fadeSlideUp 0.2s ease',
                boxShadow: '0 4px 12px rgba(0,0,0,0.3)'
            }}
            onClick={e => e.stopPropagation()}
        >
            <div className="flex-between mb-15 pb-10 border-b">
                <h2 style={{margin: 0, color: 'var(--text-main)'}}>
                    <Pencil size={16} aria-hidden="true" style={{marginRight: '6px'}} /> Modifica porzione
                </h2>
                <button 
                    type="button" 
                    className="btn-icon" 
                    onClick={onClose}
                    style={{ color: 'var(--text-muted)', fontSize: '1.1rem' }}
                >
                    ✕
                </button>
            </div>

            <div style={{ marginBottom: '15px' }}>
                <div style={{ fontWeight: 'bold', fontSize: '1rem', color: 'var(--text-main)', marginBottom: '4px' }}>
                    {item.name}
                </div>
                {item.brand && (
                    <div style={{ fontSize: '0.85rem', color: 'var(--text-muted)' }}>
                        {item.brand}
                    </div>
                )}
            </div>

            <div className="mb-15">
                <label className="text-muted text-xs block mb-4">Pasto</label>
                <select 
                    value={meal} 
                    onChange={e => setMeal(e.target.value)}
                    style={{ marginBottom: 0 }}
                >
                    {MEAL_TYPES.map(mt => (
                        <option key={mt} value={mt}>{mt}</option>
                    ))}
                </select>
            </div>

            <div className="mb-15">
                <label className="text-muted text-xs block mb-4">
                    Quantità ({item.unit || 'g'})
                </label>
                <input 
                    type="number" 
                    step="1"
                    min="0"
                    value={quantity} 
                    onChange={e => setQuantity(e.target.value)}
                    onFocus={e => e.target.select()}
                    style={{ marginBottom: 0, fontSize: '1.1rem', fontWeight: 'bold' }}
                    autoFocus
                />
            </div>

            {/* Macro Summary Preview */}
            <div 
                style={{
                    background: 'rgba(255, 255, 255, 0.04)',
                    border: '1px solid var(--glass-border)',
                    borderRadius: '10px',
                    padding: '12px',
                    marginBottom: '20px',
                    display: 'grid',
                    gridTemplateColumns: 'repeat(4, 1fr)',
                    textAlign: 'center',
                    gap: '6px'
                }}
            >
                <div>
                    <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>KCAL</div>
                    <div style={{ fontWeight: 'bold', color: 'var(--text-main)', fontSize: '0.95rem' }}>{currentKcal}</div>
                </div>
                <div>
                    <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>PRO</div>
                    <div style={{ fontWeight: 'bold', color: 'var(--text-main)', fontSize: '0.95rem' }}>{currentPro}g</div>
                </div>
                <div>
                    <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>CARBO</div>
                    <div style={{ fontWeight: 'bold', color: 'var(--text-main)', fontSize: '0.95rem' }}>{currentCarbs}g</div>
                </div>
                <div>
                    <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>GRASSI</div>
                    <div style={{ fontWeight: 'bold', color: 'var(--text-main)', fontSize: '0.95rem' }}>{currentFat}g</div>
                </div>
            </div>

            <div className="flex gap-10">
                <button 
                    type="button" 
                    className="btn" 
                    style={{ background: 'rgba(239, 68, 68, 0.15)', color: 'var(--danger-color)', border: '1px solid var(--danger-color)', flex: 1, marginBottom: 0 }}
                    onClick={handleDelete}
                >
                    <Trash2 size={16} aria-hidden="true" style={{marginRight: '6px'}} /> Rimuovi
                </button>
                <button 
                    type="button" 
                    className="btn btn-primary" 
                    style={{ flex: 2, marginBottom: 0 }}
                    onClick={handleSave}
                >
                    <Save size={16} aria-hidden="true" style={{marginRight: '6px'}} /> Salva
                </button>
            </div>
        </div>
    );
}
