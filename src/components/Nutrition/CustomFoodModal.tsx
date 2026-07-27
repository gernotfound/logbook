
export default function CustomFoodModal({ cfData, setCfData, saveCustomFood, showCustomModal }: any) {
    if (!showCustomModal) return null;

    return (
        <div style={{ marginTop: '15px', paddingTop: '15px', borderTop: '1px solid var(--glass-border)' }}>
            <div style={{ marginBottom: '10px' }}>
                <input type="text" placeholder="Nome alimento (obbligatorio)" value={cfData.name} onChange={e => setCfData({...cfData, name: e.target.value})} style={{ marginBottom: '8px' }} />
                <input type="text" placeholder="Marca (opzionale)" value={cfData.brand} onChange={e => setCfData({...cfData, brand: e.target.value})} style={{ marginBottom: '8px' }} />
            </div>
            
            <div className="input-row" style={{ marginBottom: '10px' }}>
                <div style={{ flex: 1 }}>
                    <select value={cfData.unit} onChange={e => setCfData({...cfData, unit: e.target.value})} style={{ width: '100%', padding: '10px' }}>
                        <option value="g">Grammi (g)</option>
                        <option value="ml">Millilitri (ml)</option>
                        <option value="pezzo">A pezzo / Unità</option>
                    </select>
                </div>
                {cfData.unit === 'pezzo' && (
                    <div style={{ flex: 1 }}>
                        <input type="number" placeholder="Peso 1 pezzo (g)" value={cfData.pieceWeight} onChange={e => setCfData({...cfData, pieceWeight: e.target.value})} />
                    </div>
                )}
            </div>

            <div style={{ fontSize: '0.8rem', color: 'var(--text-muted)', marginBottom: '8px' }}>Valori per 100 {cfData.unit !== 'pezzo' ? cfData.unit : 'g'}:</div>
            
            <div className="input-row" style={{ marginBottom: '10px' }}>
                <input type="number" placeholder="Kcal" value={cfData.kcal} onChange={e => setCfData({...cfData, kcal: e.target.value})} style={{ flex: 1 }} />
                <input type="number" placeholder="Carbo (g)" value={cfData.carbs} onChange={e => setCfData({...cfData, carbs: e.target.value})} style={{ flex: 1 }} />
                <input type="number" placeholder="Pro (g)" value={cfData.pro} onChange={e => setCfData({...cfData, pro: e.target.value})} style={{ flex: 1 }} />
                <input type="number" placeholder="Grassi (g)" value={cfData.fat} onChange={e => setCfData({...cfData, fat: e.target.value})} style={{ flex: 1 }} />
            </div>

            <button className="btn btn-primary" style={{ width: '100%' }} onClick={saveCustomFood}>
                💾 Salva nei miei alimenti
            </button>
        </div>
    );
}
