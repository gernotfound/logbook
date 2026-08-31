import { useNutritionPlanning } from '../../hooks/useNutritionPlanning';

const NutritionPlanning = () => {
    const { 
        planning, onMacrosCalc, offMacrosCalc, avgMacrosCalc, tdeeCalc,
        currentOnMacros, currentOffMacros,
        handleUpdate, handleUpdateAvgMacros, handleUpdateOnBoost, handleSave 
    } = useNutritionPlanning();

    return (
        <div>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '15px' }}>
                <h1 style={{margin: 0, color: 'var(--text-main)'}}>🎯 Pianificazione macro</h1>
            </div>

            <div className="input-row flex-between" style={{ marginBottom: '20px' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', width: '100%' }}>
                    <label style={{ fontSize: '1rem', color: 'var(--text-main)', margin: 0, fontWeight: 'bold' }}>Giorni ON (su 7)</label>
                    <input 
                        type="number" 
                        min="0" max="7" step="1"
                        value={planning.onDaysCount !== undefined && planning.onDaysCount !== null ? planning.onDaysCount : 4} 
                        onChange={e => handleUpdate('onDaysCount', e.target.value)} 
                        onFocus={e => e.target.select()}
                        style={{ fontSize: '1.1rem', fontWeight: 'bold', width: '80px', textAlign: 'center' }}
                    />
                </div>
            </div>

            <div style={{ display: 'flex', gap: '15px', flexDirection: 'column' }}>
                {/* 1. MEDIA SETTIMANALE */}
                <div className="card" style={{ marginBottom: 0 }}>
                    <h2 style={{marginTop: 0, marginBottom: '15px', color: 'var(--text-main)'}}>⚖️ Media settimanale desiderata</h2>
                    
                    <div className="input-row flex-between" style={{ marginBottom: '10px' }}>
                        <span style={{ color: 'var(--text-muted)' }}>Pro (g/kg)</span>
                        <input type="number" min="0" step="0.1" value={planning.avgMacros?.proPerKg ?? ''} onChange={e => handleUpdateAvgMacros('proPerKg', e.target.value)} onFocus={e => e.target.select()} style={{ width: '80px', textAlign: 'right' }} />
                    </div>
                    <div className="input-row flex-between" style={{ marginBottom: '10px' }}>
                        <span style={{ color: 'var(--text-muted)' }}>Carbo (g/kg)</span>
                        <input type="number" min="0" step="0.1" value={planning.avgMacros?.carbsPerKg ?? ''} onChange={e => handleUpdateAvgMacros('carbsPerKg', e.target.value)} onFocus={e => e.target.select()} style={{ width: '80px', textAlign: 'right' }} />
                    </div>
                    <div className="input-row flex-between" style={{ marginBottom: '15px' }}>
                        <span style={{ color: 'var(--text-muted)' }}>Grassi (g/kg)</span>
                        <input type="number" min="0" step="0.1" value={planning.avgMacros?.fatPerKg ?? ''} onChange={e => handleUpdateAvgMacros('fatPerKg', e.target.value)} onFocus={e => e.target.select()} style={{ width: '80px', textAlign: 'right' }} />
                    </div>

                    <div style={{ display: 'flex', justifyContent: 'space-between', background: 'var(--surface-color)', padding: '10px', borderRadius: '8px' }}>
                        <div style={{ textAlign: 'center' }}>
                            <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>PRO</div>
                            <div style={{ fontWeight: 'bold', color: 'var(--text-main)' }}>{Math.round(avgMacrosCalc.proGrams)}g</div>
                        </div>
                        <div style={{ textAlign: 'center' }}>
                            <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>CAR</div>
                            <div style={{ fontWeight: 'bold', color: 'var(--text-main)' }}>{Math.round(avgMacrosCalc.carbsGrams)}g</div>
                        </div>
                        <div style={{ textAlign: 'center' }}>
                            <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>GRA</div>
                            <div style={{ fontWeight: 'bold', color: 'var(--text-main)' }}>{Math.round(avgMacrosCalc.fatGrams)}g</div>
                        </div>
                        <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>KCAL</div>
                        <div style={{ fontWeight: 'bold', color: 'var(--text-main)' }}>{Math.round(avgMacrosCalc.totalKcal)}</div>
                    </div>
                    
                    <div style={{ marginTop: '10px', textAlign: 'right', fontSize: '1rem', color: 'var(--text-muted)' }}>
                        rapporto car/gra: <span style={{ fontWeight: 'bold', color: 'var(--text-main)' }}>{(avgMacrosCalc.fatGrams > 0 ? (avgMacrosCalc.carbsGrams / avgMacrosCalc.fatGrams).toFixed(2) : 0)}</span>
                    </div>
                </div>

                {/* 2. VARIAZIONI GIORNI ON */}
                <div className="card" style={{ marginBottom: 0 }}>
                    <h2 style={{marginTop: 0, marginBottom: '5px', color: 'var(--text-main)'}}>🚀 Variazioni giorni ON</h2>
                    <p style={{ fontSize: '0.85rem', color: 'var(--text-muted)', marginBottom: '15px' }}>Varia in percentuale i macro nei giorni di allenamento.</p>
                    
                    <div className="input-row flex-between" style={{ marginBottom: '10px' }}>
                        <span style={{ color: 'var(--text-muted)' }}>Variazione pro (%)</span>
                        <input type="number" step="1" value={planning.onBoost?.proPercent ?? ''} onChange={e => handleUpdateOnBoost('proPercent', e.target.value)} onFocus={e => e.target.select()} style={{ width: '80px', textAlign: 'right' }} />
                    </div>
                    <div className="input-row flex-between" style={{ marginBottom: '10px' }}>
                        <span style={{ color: 'var(--text-muted)' }}>Variazione carbo (%)</span>
                        <input type="number" step="1" value={planning.onBoost?.carbsPercent ?? ''} onChange={e => handleUpdateOnBoost('carbsPercent', e.target.value)} onFocus={e => e.target.select()} style={{ width: '80px', textAlign: 'right' }} />
                    </div>
                    <div className="input-row flex-between" style={{ marginBottom: '15px' }}>
                        <span style={{ color: 'var(--text-muted)' }}>Variazione grassi (%)</span>
                        <input type="number" step="1" value={planning.onBoost?.fatPercent ?? ''} onChange={e => handleUpdateOnBoost('fatPercent', e.target.value)} onFocus={e => e.target.select()} style={{ width: '80px', textAlign: 'right' }} />
                    </div>
                </div>

                {/* 3. RISULTATI (SOVRASCRITTI) */}
                <div style={{ display: 'flex', gap: '10px', flexDirection: 'column', marginTop: '10px' }}>
                    <div style={{ fontSize: '1.1rem', fontWeight: 'bold', marginBottom: '5px', color: 'var(--text-main)' }}>📊 Ripartizione calcolata</div>
                    
                    {/* GIORNO ON */}
                    <div className="card" style={{ marginBottom: 0, padding: '15px' }}>
                        <div style={{ fontSize: '0.95rem', color: 'var(--primary-color)', fontWeight: 'bold', marginBottom: '10px' }}>🔥 Giorno ON (Allenamento)</div>
                        <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '10px' }}>
                            <div style={{ fontSize: '0.85rem', color: 'var(--text-muted)' }}>Pro: <span style={{ color: 'var(--text-main)' }}>{Number(currentOnMacros.proPerKg).toFixed(2)} g/kg</span></div>
                            <div style={{ fontSize: '0.85rem', color: 'var(--text-muted)' }}>Car: <span style={{ color: 'var(--text-main)' }}>{Number(currentOnMacros.carbsPerKg).toFixed(2)} g/kg</span></div>
                            <div style={{ fontSize: '0.85rem', color: 'var(--text-muted)' }}>Gra: <span style={{ color: 'var(--text-main)' }}>{Number(currentOnMacros.fatPerKg).toFixed(2)} g/kg</span></div>
                        </div>
                        <div style={{ display: 'flex', justifyContent: 'space-between', background: 'var(--surface-color)', padding: '8px', borderRadius: '6px' }}>
                            <div style={{ textAlign: 'center', flex: 1 }}><div style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>PRO</div><div style={{ fontWeight: 'bold', color: 'var(--text-main)' }}>{Math.round(onMacrosCalc.proGrams)}g</div></div>
                            <div style={{ textAlign: 'center', flex: 1 }}><div style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>CAR</div><div style={{ fontWeight: 'bold', color: 'var(--text-main)' }}>{Math.round(onMacrosCalc.carbsGrams)}g</div></div>
                            <div style={{ textAlign: 'center', flex: 1 }}><div style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>GRA</div><div style={{ fontWeight: 'bold', color: 'var(--text-main)' }}>{Math.round(onMacrosCalc.fatGrams)}g</div></div>
                            <div style={{ textAlign: 'center', flex: 1, borderLeft: '1px solid var(--glass-border)' }}><div style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>KCAL</div><div style={{ fontWeight: 'bold', color: 'var(--text-main)' }}>{Math.round(onMacrosCalc.totalKcal)}</div></div>
                        </div>
                    </div>

                    {/* GIORNO OFF */}
                    <div className="card" style={{ marginBottom: 0, padding: '15px' }}>
                        <div style={{ fontSize: '0.95rem', color: 'var(--text-main)', fontWeight: 'bold', marginBottom: '10px' }}>🛋️ Giorno OFF (Riposo)</div>
                        <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '10px' }}>
                            <div style={{ fontSize: '0.85rem', color: 'var(--text-muted)' }}>Pro: <span style={{ color: 'var(--text-main)' }}>{Number(currentOffMacros.proPerKg).toFixed(2)} g/kg</span></div>
                            <div style={{ fontSize: '0.85rem', color: 'var(--text-muted)' }}>Car: <span style={{ color: 'var(--text-main)' }}>{Number(currentOffMacros.carbsPerKg).toFixed(2)} g/kg</span></div>
                            <div style={{ fontSize: '0.85rem', color: 'var(--text-muted)' }}>Gra: <span style={{ color: 'var(--text-main)' }}>{Number(currentOffMacros.fatPerKg).toFixed(2)} g/kg</span></div>
                        </div>
                        <div style={{ display: 'flex', justifyContent: 'space-between', background: 'var(--surface-color)', padding: '8px', borderRadius: '6px' }}>
                            <div style={{ textAlign: 'center', flex: 1 }}><div style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>PRO</div><div style={{ fontWeight: 'bold', color: 'var(--text-main)' }}>{Math.round(offMacrosCalc.proGrams)}g</div></div>
                            <div style={{ textAlign: 'center', flex: 1 }}><div style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>CAR</div><div style={{ fontWeight: 'bold', color: 'var(--text-main)' }}>{Math.round(offMacrosCalc.carbsGrams)}g</div></div>
                            <div style={{ textAlign: 'center', flex: 1 }}><div style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>GRA</div><div style={{ fontWeight: 'bold', color: 'var(--text-main)' }}>{Math.round(offMacrosCalc.fatGrams)}g</div></div>
                            <div style={{ textAlign: 'center', flex: 1, borderLeft: '1px solid var(--glass-border)' }}><div style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>KCAL</div><div style={{ fontWeight: 'bold', color: 'var(--text-main)' }}>{Math.round(offMacrosCalc.totalKcal)}</div></div>
                        </div>
                    </div>
                </div>
            </div>

            {/* NOTE */}
            <div className="card" style={{ marginTop: '5px' }}>
                <div style={{ fontSize: '1.1rem', fontWeight: 'bold', marginBottom: '10px', color: 'var(--text-main)' }}>📝 Note</div>
                <textarea 
                    placeholder="Scrivi qui eventuali note (es. integratori, orari dei pasti, variazioni nei giorni off...)"
                    value={planning.notes || ''}
                    onChange={e => handleUpdate('notes', e.target.value)}
                    style={{ 
                        width: '100%', 
                        minHeight: '80px', 
                        boxSizing: 'border-box', 
                        background: 'var(--surface-light)', 
                        border: '1px solid var(--glass-border)',
                        borderRadius: '8px',
                        padding: '10px',
                        color: 'var(--text-main)',
                        fontSize: '16px',
                        resize: 'vertical'
                    }}
                />
            </div>
            
            <button 
                className="btn btn-primary" 
                style={{ width: '100%', marginTop: '20px', padding: '15px' }} 
                onClick={handleSave}
            >
                💾 Salva pianificazione
            </button>

            {/* TDEE COMPARE (Automatico) */}
            <div className="card" style={{ marginTop: '30px', padding: '15px' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '15px' }}>
                    <h2 style={{margin: 0,color: 'var(--text-main)'}}>⚖️ TDEE (normocalorica)</h2>
                </div>
                
                <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '15px', background: 'var(--surface-color)', padding: '10px', borderRadius: '8px' }}>
                    <div style={{ textAlign: 'center' }}>
                        <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>TDEE (normo stimato)</div>
                        <div style={{ fontWeight: 'bold', fontSize: '1.2rem', color: 'var(--text-main)' }}>{Math.round(tdeeCalc.tdee || 0)}</div>
                    </div>
                    <div style={{ textAlign: 'center' }}>
                        <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>MEDIA IMPOSTATA</div>
                        <div style={{ fontWeight: 'bold', fontSize: '1.2rem', color: 'var(--text-main)' }}>{Math.round(avgMacrosCalc.totalKcal)}</div>
                    </div>
                </div>
                <div style={{ fontSize: '0.85rem', color: 'var(--text-muted)', textAlign: 'center', marginTop: '10px' }}>
                    Il tuo TDEE viene calcolato automaticamente in base alle tue misurazioni corporee e profilo.
                </div>
            </div>
            
            <div style={{ height: '30px' }}></div>
        </div>
    );
};

export default NutritionPlanning;
