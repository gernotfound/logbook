import type { useNutritionPlanning } from '../../hooks/useNutritionPlanning';

type NutritionPlanningFieldsProps = Pick<ReturnType<typeof useNutritionPlanning>,
    'planning' | 'avgMacrosCalc' | 'handleUpdateAvgMacros' | 'handleUpdateOnBoost'>;

export function NutritionPlanningFields({ planning, avgMacrosCalc, handleUpdateAvgMacros, handleUpdateOnBoost }: NutritionPlanningFieldsProps) {
    return (
        <>
            {/* 1. MEDIA SETTIMANALE */}
            <div className="card" style={{ marginBottom: 0 }}>
                <h2 style={{marginTop: 0, marginBottom: '15px', color: 'var(--text-main)'}}>⚖️ Media settimanale desiderata</h2>
                    
                <div className="input-row flex-between" style={{ marginBottom: '10px' }}>
                    <label htmlFor="nutrition-average-pro" style={{ color: 'var(--text-muted)' }}>Pro (g/kg)</label>
                    <input id="nutrition-average-pro" type="number" min="0" step="0.1" value={planning.avgMacros?.proPerKg ?? ''} onChange={e => handleUpdateAvgMacros('proPerKg', e.target.value)} onFocus={e => e.target.select()} style={{ width: '80px', textAlign: 'right' }} />
                </div>
                <div className="input-row flex-between" style={{ marginBottom: '10px' }}>
                    <label htmlFor="nutrition-average-carbs" style={{ color: 'var(--text-muted)' }}>Carbo (g/kg)</label>
                    <input id="nutrition-average-carbs" type="number" min="0" step="0.1" value={planning.avgMacros?.carbsPerKg ?? ''} onChange={e => handleUpdateAvgMacros('carbsPerKg', e.target.value)} onFocus={e => e.target.select()} style={{ width: '80px', textAlign: 'right' }} />
                </div>
                <div className="input-row flex-between" style={{ marginBottom: '15px' }}>
                    <label htmlFor="nutrition-average-fat" style={{ color: 'var(--text-muted)' }}>Grassi (g/kg)</label>
                    <input id="nutrition-average-fat" type="number" min="0" step="0.1" value={planning.avgMacros?.fatPerKg ?? ''} onChange={e => handleUpdateAvgMacros('fatPerKg', e.target.value)} onFocus={e => e.target.select()} style={{ width: '80px', textAlign: 'right' }} />
                </div>

                <div style={{ display: 'flex', justifyContent: 'space-between', background: 'var(--surface-color)', padding: '10px', borderRadius: '8px' }}>
                    <div style={{ textAlign: 'center' }}>
                        <div style={{ fontSize: 'var(--font-size-micro)', color: 'var(--text-muted)' }}>PRO</div>
                        <div style={{ fontWeight: 'bold', color: 'var(--text-main)' }}>{Math.round(avgMacrosCalc.proGrams)}g</div>
                    </div>
                    <div style={{ textAlign: 'center' }}>
                        <div style={{ fontSize: 'var(--font-size-micro)', color: 'var(--text-muted)' }}>CAR</div>
                        <div style={{ fontWeight: 'bold', color: 'var(--text-main)' }}>{Math.round(avgMacrosCalc.carbsGrams)}g</div>
                    </div>
                    <div style={{ textAlign: 'center' }}>
                        <div style={{ fontSize: 'var(--font-size-micro)', color: 'var(--text-muted)' }}>GRA</div>
                        <div style={{ fontWeight: 'bold', color: 'var(--text-main)' }}>{Math.round(avgMacrosCalc.fatGrams)}g</div>
                    </div>
                    <div style={{ fontSize: 'var(--font-size-micro)', color: 'var(--text-muted)' }}>KCAL</div>
                    <div style={{ fontWeight: 'bold', color: 'var(--text-main)' }}>{Math.round(avgMacrosCalc.totalKcal)}</div>
                </div>
                    
                <div style={{ marginTop: '10px', textAlign: 'right', fontSize: 'var(--font-size-control)', color: 'var(--text-muted)' }}>
                    rapporto car/gra: <span style={{ fontWeight: 'bold', color: 'var(--text-main)' }}>{(avgMacrosCalc.fatGrams > 0 ? (avgMacrosCalc.carbsGrams / avgMacrosCalc.fatGrams).toFixed(2) : 0)}</span>
                </div>
            </div>

            {/* 2. VARIAZIONI GIORNI ON */}
            <div className="card" style={{ marginBottom: 0 }}>
                <h2 style={{marginTop: 0, marginBottom: '5px', color: 'var(--text-main)'}}>🚀 Variazioni giorni ON</h2>
                <p style={{ fontSize: 'var(--font-size-body)', color: 'var(--text-muted)', marginBottom: '15px' }}>Varia in percentuale i macro nei giorni di allenamento.</p>
                    
                <div className="input-row flex-between" style={{ marginBottom: '10px' }}>
                    <label htmlFor="nutrition-on-pro" style={{ color: 'var(--text-muted)' }}>Variazione pro (%)</label>
                    <input id="nutrition-on-pro" type="number" min="-100" step="1" value={planning.onBoost?.proPercent ?? ''} onChange={e => handleUpdateOnBoost('proPercent', e.target.value)} onFocus={e => e.target.select()} style={{ width: '80px', textAlign: 'right' }} />
                </div>
                <div className="input-row flex-between" style={{ marginBottom: '10px' }}>
                    <label htmlFor="nutrition-on-carbs" style={{ color: 'var(--text-muted)' }}>Variazione carbo (%)</label>
                    <input id="nutrition-on-carbs" type="number" min="-100" step="1" value={planning.onBoost?.carbsPercent ?? ''} onChange={e => handleUpdateOnBoost('carbsPercent', e.target.value)} onFocus={e => e.target.select()} style={{ width: '80px', textAlign: 'right' }} />
                </div>
                <div className="input-row flex-between" style={{ marginBottom: '15px' }}>
                    <label htmlFor="nutrition-on-fat" style={{ color: 'var(--text-muted)' }}>Variazione grassi (%)</label>
                    <input id="nutrition-on-fat" type="number" min="-100" step="1" value={planning.onBoost?.fatPercent ?? ''} onChange={e => handleUpdateOnBoost('fatPercent', e.target.value)} onFocus={e => e.target.select()} style={{ width: '80px', textAlign: 'right' }} />
                </div>
            </div>
        </>
    );
}
