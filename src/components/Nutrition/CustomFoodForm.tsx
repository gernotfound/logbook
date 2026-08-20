interface CustomFoodFormProps {
    cfData: any;
    setCfData: (data: any) => void;
    saveCustomFood: () => Promise<void>;
    showCustomModal: boolean;
    setShowCustomModal: (show: boolean) => void;
    isEditing?: boolean;
    onCancel?: () => void;
}

export default function CustomFoodForm({ 
    cfData, 
    setCfData, 
    saveCustomFood, 
    showCustomModal, 
    setShowCustomModal,
    isEditing = false,
    onCancel
}: CustomFoodFormProps) {
    if (!showCustomModal) return null;

    const handleCancel = () => {
        if (onCancel) {
            onCancel();
        } else {
            setShowCustomModal(false);
        }
    };

    const handleMacroChange = (field: 'carbs' | 'pro' | 'fat', value: string) => {
        const updated = { ...cfData, [field]: value };
        const cStr = field === 'carbs' ? value : String(updated.carbs ?? '');
        const pStr = field === 'pro' ? value : String(updated.pro ?? '');
        const fStr = field === 'fat' ? value : String(updated.fat ?? '');

        const c = parseFloat(cStr.trim().replace(',', '.')) || 0;
        const p = parseFloat(pStr.trim().replace(',', '.')) || 0;
        const f = parseFloat(fStr.trim().replace(',', '.')) || 0;

        const hasAnyMacro = Boolean(cStr.trim() || pStr.trim() || fStr.trim());
        if (hasAnyMacro) {
            const autoKcal = Math.round((c * 4) + (p * 4) + (f * 9));
            updated.kcal = autoKcal;
        } else {
            updated.kcal = '';
        }

        setCfData(updated);
    };

    return (
        <div style={{ marginTop: '15px', paddingTop: '15px', borderTop: '1px solid var(--glass-border)' }}>
            <h3 style={{ color: 'var(--text-main)', marginBottom: '12px', fontSize: '1rem' }}>
                {isEditing ? '✏️ Modifica alimento' : '➕ Nuovo alimento personalizzato'}
            </h3>
            
            <div style={{ marginBottom: '10px' }}>
                <label className="text-muted text-xs block mb-4" htmlFor="cf-name">Nome alimento *</label>
                <input 
                    id="cf-name" 
                    type="text" 
                    placeholder="es. Petto di pollo, Fiocchi di latte..." 
                    value={cfData.name || ''} 
                    onChange={e => setCfData({...cfData, name: e.target.value})} 
                    onFocus={e => e.target.select()}
                    style={{ marginBottom: '8px', fontSize: '16px' }} 
                />
                <label className="text-muted text-xs block mb-4" htmlFor="cf-brand">Marca (opzionale)</label>
                <input 
                    id="cf-brand" 
                    type="text" 
                    placeholder="es. MyProtein, AIA, Coop..." 
                    value={cfData.brand || ''} 
                    onChange={e => setCfData({...cfData, brand: e.target.value})} 
                    onFocus={e => e.target.select()}
                    style={{ marginBottom: '8px', fontSize: '16px' }} 
                />
            </div>
            
            <div className="input-row" style={{ marginBottom: '10px' }}>
                <div style={{ flex: 1, minWidth: 0 }}>
                    <label className="text-muted text-xs block mb-4">Unità di misura</label>
                    <select 
                        value={cfData.unit || 'g'} 
                        onChange={e => setCfData({...cfData, unit: e.target.value})} 
                        style={{ width: '100%', marginBottom: 0, fontSize: '16px' }}
                    >
                        <option value="g">Grammi (g)</option>
                        <option value="ml">Millilitri (ml)</option>
                        <option value="pezzo">A pezzo / unità</option>
                    </select>
                </div>
                {cfData.unit === 'pezzo' && (
                    <div style={{ flex: 1, minWidth: 0 }}>
                        <label className="text-muted text-xs block mb-4" htmlFor="cf-piece-weight">Peso 1 pezzo (g)</label>
                        <input 
                            id="cf-piece-weight" 
                            type="number" 
                            inputMode="decimal"
                            placeholder="es. 60" 
                            value={cfData.pieceWeight || ''} 
                            onChange={e => setCfData({...cfData, pieceWeight: e.target.value})} 
                            onFocus={e => e.target.select()}
                            style={{ marginBottom: 0, fontSize: '16px' }} 
                        />
                    </div>
                )}
            </div>

            <div style={{ fontSize: '0.8rem', color: 'var(--text-muted)', marginBottom: '8px' }}>
                Valori per 100 {cfData.unit !== 'pezzo' ? (cfData.unit || 'g') : 'g'}:
            </div>
            
            <div className="input-row" style={{ marginBottom: '15px' }}>
                <div style={{ flex: 1, minWidth: 0 }}>
                    <label className="text-muted text-xs block mb-4" htmlFor="cf-kcal">Kcal</label>
                    <input 
                        id="cf-kcal" 
                        type="number" 
                        inputMode="decimal"
                        placeholder="0" 
                        value={cfData.kcal ?? ''} 
                        onChange={e => setCfData({...cfData, kcal: e.target.value})} 
                        onFocus={e => e.target.select()}
                        style={{ marginBottom: 0, fontSize: '16px' }} 
                    />
                </div>
                <div style={{ flex: 1, minWidth: 0 }}>
                    <label className="text-muted text-xs block mb-4" htmlFor="cf-pro">Pro (g)</label>
                    <input 
                        id="cf-pro" 
                        type="number" 
                        inputMode="decimal"
                        step="0.1"
                        placeholder="0" 
                        value={cfData.pro ?? ''} 
                        onChange={e => handleMacroChange('pro', e.target.value)} 
                        onFocus={e => e.target.select()}
                        style={{ marginBottom: 0, fontSize: '16px' }} 
                    />
                </div>
                <div style={{ flex: 1, minWidth: 0 }}>
                    <label className="text-muted text-xs block mb-4" htmlFor="cf-carbs">Carbo (g)</label>
                    <input 
                        id="cf-carbs" 
                        type="number" 
                        inputMode="decimal"
                        step="0.1"
                        placeholder="0" 
                        value={cfData.carbs ?? ''} 
                        onChange={e => handleMacroChange('carbs', e.target.value)} 
                        onFocus={e => e.target.select()}
                        style={{ marginBottom: 0, fontSize: '16px' }} 
                    />
                </div>
                <div style={{ flex: 1, minWidth: 0 }}>
                    <label className="text-muted text-xs block mb-4" htmlFor="cf-fat">Grassi (g)</label>
                    <input 
                        id="cf-fat" 
                        type="number" 
                        inputMode="decimal"
                        step="0.1"
                        placeholder="0" 
                        value={cfData.fat ?? ''} 
                        onChange={e => handleMacroChange('fat', e.target.value)} 
                        onFocus={e => e.target.select()}
                        style={{ marginBottom: 0, fontSize: '16px' }} 
                    />
                </div>
            </div>

            <div className="flex gap-10">
                <button 
                    type="button"
                    className="btn flex-1" 
                    style={{ background: 'rgba(255,255,255,0.08)', marginBottom: 0 }} 
                    onClick={handleCancel}
                >
                    Annulla
                </button>
                <button 
                    type="button"
                    className="btn btn-primary flex-2" 
                    style={{ marginBottom: 0 }} 
                    onClick={saveCustomFood}
                >
                    {isEditing ? '💾 Salva modifiche' : '💾 Salva alimento'}
                </button>
            </div>
        </div>
    );
}
