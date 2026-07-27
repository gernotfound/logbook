import { Logic } from '../../lib/logic';
import { useNutritionPlanning } from '../../hooks/useNutritionPlanning';

const NutritionPlanning = () => {
    const { 
        planning, macros, totalKcal, 
        handleUpdate, handleSave, handleCopyFromTDEE 
    } = useNutritionPlanning();

    return (
        <div className="card planning-target-card">
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '15px' }}>
                <h3 style={{ margin: 0, color: 'var(--text-main)' }}>🎯 Target Calorico & Macro</h3>
            </div>

            <div className="input-row" style={{ marginBottom: '20px' }}>
                <div style={{ flex: 1 }}>
                    <label style={{ fontSize: '0.8rem', color: 'var(--text-muted)', display: 'block', marginBottom: '4px' }}>Peso di calcolo (kg)</label>
                    <input 
                        type="number" 
                        value={planning.weight} 
                        onChange={e => handleUpdate('weight', parseFloat(e.target.value) || 0)}
                        style={{ fontSize: '1.2rem', fontWeight: 'bold' }}
                    />
                </div>
                <div style={{ flex: 1, textAlign: 'right' }}>
                    <span style={{ fontSize: '0.8rem', color: 'var(--text-muted)', display: 'block', marginBottom: '4px' }}>Target Totale</span>
                    <div style={{ fontSize: '1.8rem', fontWeight: 800, color: 'var(--primary-color)' }}>
                        {Math.round(totalKcal) || 0} <span style={{ fontSize: '1rem', fontWeight: 'normal', color: 'var(--text-muted)' }}>kcal</span>
                    </div>
                </div>
            </div>

            <div className="macro-chips-row" style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: '10px' }}>
                <div className="macro-chip carbs" style={{ background: 'rgba(0,0,0,0.2)', padding: '10px', borderRadius: '10px', textAlign: 'center' }}>
                    <span style={{ fontSize: '0.7rem', color: 'var(--primary-color)', fontWeight: 'bold' }}>CARBO</span>
                    <div style={{ fontSize: '1.1rem', fontWeight: 'bold' }}>{Math.round(macros.carbsGrams) || 0}g</div>
                </div>
                <div className="macro-chip pro" style={{ background: 'rgba(0,0,0,0.2)', padding: '10px', borderRadius: '10px', textAlign: 'center' }}>
                    <span style={{ fontSize: '0.7rem', color: 'var(--success-color)', fontWeight: 'bold' }}>PRO</span>
                    <div style={{ fontSize: '1.1rem', fontWeight: 'bold' }}>{Math.round(macros.proGrams) || 0}g</div>
                </div>
                <div className="macro-chip fat" style={{ background: 'rgba(0,0,0,0.2)', padding: '10px', borderRadius: '10px', textAlign: 'center' }}>
                    <span style={{ fontSize: '0.7rem', color: 'var(--danger-color)', fontWeight: 'bold' }}>GRASSI</span>
                    <div style={{ fontSize: '1.1rem', fontWeight: 'bold' }}>{Math.round(macros.fatGrams) || 0}g</div>
                </div>
            </div>

            <h3 style={{ marginTop: '30px', marginBottom: '20px' }}>⚖️ Configurazione Macro per kg</h3>

            <div style={{ marginBottom: '15px', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <span style={{ color: 'var(--primary-color)' }}>Carboidrati (g/kg)</span>
                <input 
                    type="number" min="0" max="10" step="0.1" 
                    value={planning.carbsPerKg} 
                    onChange={e => handleUpdate('carbsPerKg', parseFloat(e.target.value) || 0)}
                    style={{ width: '100px', textAlign: 'right' }}
                />
            </div>

            <div style={{ marginBottom: '15px', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <span style={{ color: 'var(--success-color)' }}>Proteine (g/kg)</span>
                <input 
                    type="number" min="0.5" max="4.0" step="0.1" 
                    value={planning.proPerKg} 
                    onChange={e => handleUpdate('proPerKg', parseFloat(e.target.value) || 0)}
                    style={{ width: '100px', textAlign: 'right' }}
                />
            </div>

            <div style={{ marginBottom: '15px', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <span style={{ color: 'var(--danger-color)' }}>Grassi (g/kg)</span>
                <input 
                    type="number" min="0.2" max="3.0" step="0.1" 
                    value={planning.fatPerKg} 
                    onChange={e => handleUpdate('fatPerKg', parseFloat(e.target.value) || 0)}
                    style={{ width: '100px', textAlign: 'right' }}
                />
            </div>

            <div className="card" style={{ marginTop: '30px', padding: '15px', background: 'rgba(255,255,255,0.02)' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '15px' }}>
                    <h3 style={{ margin: 0 }}>🔥 Normocalorica di Riferimento</h3>
                    <button className="btn btn-small" style={{ background: 'rgba(255,255,255,0.05)', color: 'var(--primary-color)' }} onClick={handleCopyFromTDEE}>
                        Copia da TDEE
                    </button>
                </div>
                <div className="input-row" style={{ marginBottom: '12px' }}>
                    <div style={{ flex: 2 }}>
                        <label style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>Kcal Mantenimento</label>
                        <input type="number" value={planning.normocalorica?.kcal || 0} onChange={e => handleUpdate('normocalorica', { ...(planning.normocalorica || {}), kcal: parseFloat(e.target.value) || 0 })} style={{ width: '100%' }} />
                    </div>
                    <div style={{ flex: 1 }}>
                        <label style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>CHO (g)</label>
                        <input type="number" value={planning.normocalorica?.carbs || 0} onChange={e => handleUpdate('normocalorica', { ...(planning.normocalorica || {}), carbs: parseFloat(e.target.value) || 0 })} style={{ width: '100%' }} />
                    </div>
                    <div style={{ flex: 1 }}>
                        <label style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>PRO (g)</label>
                        <input type="number" value={planning.normocalorica?.pro || 0} onChange={e => handleUpdate('normocalorica', { ...(planning.normocalorica || {}), pro: parseFloat(e.target.value) || 0 })} style={{ width: '100%' }} />
                    </div>
                    <div style={{ flex: 1 }}>
                        <label style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>FAT (g)</label>
                        <input type="number" value={planning.normocalorica?.fat || 0} onChange={e => handleUpdate('normocalorica', { ...(planning.normocalorica || {}), fat: parseFloat(e.target.value) || 0 })} style={{ width: '100%' }} />
                    </div>
                </div>
                
                <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap', justifyContent: 'space-between', marginTop: '10px' }}>
                    {(() => {
                        const diff = Logic.calculateNormocaloricaDiff(macros, planning.normocalorica || { kcal: 0, carbs: 0, pro: 0, fat: 0 });
                        if (!diff) return null;
                        
                        const getBadgeClass = (val: number) => val > 0 ? 'badge-primary' : (val < 0 ? 'badge-danger' : ''); 
                        const carbsVal = diff.carbsPct ?? 0;
                        const proVal = diff.proPct ?? 0;
                        const fatVal = diff.fatPct ?? 0;
                        const kcalVal = diff.kcalPct ?? 0;
                        return (
                            <>
                                <span className={`badge ${getBadgeClass(carbsVal)}`} style={{ background: carbsVal === 0 ? 'rgba(255,255,255,0.1)' : undefined }}>
                                    CHO: {carbsVal > 0 ? '+' : ''}{carbsVal}%
                                </span>
                                <span className={`badge ${getBadgeClass(proVal)}`} style={{ background: proVal === 0 ? 'rgba(255,255,255,0.1)' : undefined }}>
                                    PRO: {proVal > 0 ? '+' : ''}{proVal}%
                                </span>
                                <span className={`badge ${getBadgeClass(fatVal)}`} style={{ background: fatVal === 0 ? 'rgba(255,255,255,0.1)' : undefined }}>
                                    FAT: {fatVal > 0 ? '+' : ''}{fatVal}%
                                </span>
                                <span className={`badge ${getBadgeClass(kcalVal)}`} style={{ background: kcalVal === 0 ? 'rgba(255,255,255,0.1)' : undefined }}>
                                    KCAL: {kcalVal > 0 ? '+' : ''}{kcalVal}%
                                </span>
                            </>
                        );
                    })()}
                </div>
            </div>

            <button className="btn btn-primary" style={{ width: '100%', marginTop: '20px' }} onClick={handleSave}>
                💾 Salva Pianificazione
            </button>
        </div>
    );
};

export default NutritionPlanning;
