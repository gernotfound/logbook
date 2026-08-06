interface CustomFoodModalProps {
    cfData: any;
    setCfData: (data: any) => void;
    saveCustomFood: () => Promise<void>;
    showCustomModal: boolean;
    setShowCustomModal: (show: boolean) => void;
    isEditing?: boolean;
    onCancel?: () => void;
}

export default function CustomFoodModal({ 
    cfData, 
    setCfData, 
    saveCustomFood, 
    showCustomModal, 
    setShowCustomModal,
    isEditing = false,
    onCancel
}: CustomFoodModalProps) {
    if (!showCustomModal) return null;

    const handleCancel = () => {
        if (onCancel) {
            onCancel();
        } else {
            setShowCustomModal(false);
        }
    };

    return (
        <div style={{ marginTop: '15px', paddingTop: '15px', borderTop: '1px solid var(--glass-border)' }}>
            <h4 style={{ color: 'var(--primary-color)', marginBottom: '12px', fontSize: '1rem' }}>
                {isEditing ? '✏️ Modifica Alimento' : '➕ Nuovo Alimento Personalizzato'}
            </h4>
            
            <div style={{ marginBottom: '10px' }}>
                <label className="text-muted text-xs block mb-4">Nome Alimento *</label>
                <input 
                    id="cf-name" 
                    type="text" 
                    placeholder="es. Petto di pollo, Fiocchi di latte..." 
                    value={cfData.name || ''} 
                    onChange={e => setCfData({...cfData, name: e.target.value})} 
                    onFocus={e => e.target.select()}
                    style={{ marginBottom: '8px' }} 
                />
                <label className="text-muted text-xs block mb-4">Marca (opzionale)</label>
                <input 
                    id="cf-brand" 
                    type="text" 
                    placeholder="es. MyProtein, AIA, Coop..." 
                    value={cfData.brand || ''} 
                    onChange={e => setCfData({...cfData, brand: e.target.value})} 
                    onFocus={e => e.target.select()}
                    style={{ marginBottom: '8px' }} 
                />
            </div>
            
            <div className="input-row" style={{ marginBottom: '10px' }}>
                <div style={{ flex: 1 }}>
                    <label className="text-muted text-xs block mb-4">Unità di misura</label>
                    <select 
                        value={cfData.unit || 'g'} 
                        onChange={e => setCfData({...cfData, unit: e.target.value})} 
                        style={{ width: '100%', marginBottom: 0 }}
                    >
                        <option value="g">Grammi (g)</option>
                        <option value="ml">Millilitri (ml)</option>
                        <option value="pezzo">A pezzo / Unità</option>
                    </select>
                </div>
                {cfData.unit === 'pezzo' && (
                    <div style={{ flex: 1 }}>
                        <label className="text-muted text-xs block mb-4">Peso 1 pezzo (g)</label>
                        <input 
                            id="cf-piece-weight" 
                            type="number" 
                            placeholder="es. 60" 
                            value={cfData.pieceWeight || ''} 
                            onChange={e => setCfData({...cfData, pieceWeight: e.target.value})} 
                            onFocus={e => e.target.select()}
                            style={{ marginBottom: 0 }}
                        />
                    </div>
                )}
            </div>

            <div style={{ fontSize: '0.8rem', color: 'var(--text-muted)', marginBottom: '8px' }}>
                Valori per 100 {cfData.unit !== 'pezzo' ? (cfData.unit || 'g') : 'g'}:
            </div>
            
            <div className="input-row" style={{ marginBottom: '15px' }}>
                <div style={{ flex: 1 }}>
                    <label className="text-muted text-xs block mb-4">Kcal</label>
                    <input 
                        id="cf-kcal" 
                        type="number" 
                        placeholder="0" 
                        value={cfData.kcal ?? ''} 
                        onChange={e => setCfData({...cfData, kcal: e.target.value})} 
                        onFocus={e => e.target.select()}
                        style={{ marginBottom: 0 }} 
                    />
                </div>
                <div style={{ flex: 1 }}>
                    <label className="text-muted text-xs block mb-4">Carbo (g)</label>
                    <input 
                        id="cf-carbs" 
                        type="number" 
                        step="0.1"
                        placeholder="0" 
                        value={cfData.carbs ?? ''} 
                        onChange={e => setCfData({...cfData, carbs: e.target.value})} 
                        onFocus={e => e.target.select()}
                        style={{ marginBottom: 0 }} 
                    />
                </div>
                <div style={{ flex: 1 }}>
                    <label className="text-muted text-xs block mb-4">Pro (g)</label>
                    <input 
                        id="cf-pro" 
                        type="number" 
                        step="0.1"
                        placeholder="0" 
                        value={cfData.pro ?? ''} 
                        onChange={e => setCfData({...cfData, pro: e.target.value})} 
                        onFocus={e => e.target.select()}
                        style={{ marginBottom: 0 }} 
                    />
                </div>
                <div style={{ flex: 1 }}>
                    <label className="text-muted text-xs block mb-4">Grassi (g)</label>
                    <input 
                        id="cf-fat" 
                        type="number" 
                        step="0.1"
                        placeholder="0" 
                        value={cfData.fat ?? ''} 
                        onChange={e => setCfData({...cfData, fat: e.target.value})} 
                        onFocus={e => e.target.select()}
                        style={{ marginBottom: 0 }} 
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
                    {isEditing ? '💾 Salva Modifiche' : '💾 Salva Alimento'}
                </button>
            </div>
        </div>
    );
}
