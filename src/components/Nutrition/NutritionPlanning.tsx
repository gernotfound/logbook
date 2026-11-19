import { useNutritionPlanning } from '../../hooks/useNutritionPlanning';
import { Save } from 'lucide-react';
import { NutritionPlanningFields } from './NutritionPlanningFields';
import { NutritionMacroDaySummary } from './NutritionMacroDaySummary';

const NutritionPlanning = () => {
    const { 
        planning, saveStatus, onMacrosCalc, offMacrosCalc, avgMacrosCalc, tdeeCalc,
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
                    <label htmlFor="nutrition-on-days" style={{ fontSize: 'var(--font-size-control)', color: 'var(--text-main)', margin: 0, fontWeight: 'bold' }}>Giorni ON (su 7)</label>
                    <input 
                        id="nutrition-on-days"
                        type="number" 
                        min="0" max="7" step="1"
                        value={planning.onDaysCount !== undefined && planning.onDaysCount !== null ? planning.onDaysCount : 4} 
                        onChange={e => handleUpdate('onDaysCount', e.target.value)} 
                        onFocus={e => e.target.select()}
                        style={{ fontSize: 'var(--font-size-section)', fontWeight: 'bold', width: '80px', textAlign: 'center' }}
                    />
                </div>
            </div>

            <div style={{ display: 'flex', gap: '15px', flexDirection: 'column' }}>
                <NutritionPlanningFields planning={planning} avgMacrosCalc={avgMacrosCalc}
                    handleUpdateAvgMacros={handleUpdateAvgMacros} handleUpdateOnBoost={handleUpdateOnBoost} />

                {/* 3. RISULTATI (SOVRASCRITTI) */}
                <div style={{ display: 'flex', gap: '10px', flexDirection: 'column', marginTop: '10px' }}>
                    <div style={{ fontSize: 'var(--font-size-section)', fontWeight: 'bold', marginBottom: '5px', color: 'var(--text-main)' }}>📊 Ripartizione calcolata</div>
                    
                    <NutritionMacroDaySummary mode="on" macroRatios={currentOnMacros} macroTotals={onMacrosCalc} />
                    <NutritionMacroDaySummary mode="off" macroRatios={currentOffMacros} macroTotals={offMacrosCalc} />
                </div>
            </div>

            {/* NOTE */}
            <div className="card" style={{ marginTop: '5px' }}>
                <label htmlFor="nutrition-planning-notes" style={{ fontSize: 'var(--font-size-section)', fontWeight: 'bold', marginBottom: '10px', color: 'var(--text-main)', display: 'block' }}>📝 Note</label>
                <textarea
                    id="nutrition-planning-notes" 
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
                <Save size={16} aria-hidden="true" style={{marginRight: '6px'}} /> Salva pianificazione
            </button>

            {saveStatus !== 'idle' && (
                <p role="status" style={{ color: 'var(--text-muted)', marginTop: '10px' }}>
                    {saveStatus === 'saving'
                        ? 'Salvataggio della pianificazione in corso...'
                        : 'Modifiche non ancora salvate sul dispositivo.'}
                </p>
            )}

            {/* TDEE COMPARE (Automatico) */}
            <div className="card" style={{ marginTop: '30px', padding: '15px' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '15px' }}>
                    <h2 style={{margin: 0,color: 'var(--text-main)'}}>⚖️ TDEE (normocalorica)</h2>
                </div>
                
                <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '15px', background: 'var(--surface-color)', padding: '10px', borderRadius: '8px' }}>
                    <div style={{ textAlign: 'center' }}>
                        <div style={{ fontSize: 'var(--font-size-micro)', color: 'var(--text-muted)' }}>TDEE (normo stimato)</div>
                        <div style={{ fontWeight: 'bold', fontSize: 'var(--font-size-display-sm)', color: 'var(--text-main)' }}>{Math.round(tdeeCalc.tdee || 0)}</div>
                    </div>
                    <div style={{ textAlign: 'center' }}>
                        <div style={{ fontSize: 'var(--font-size-micro)', color: 'var(--text-muted)' }}>MEDIA IMPOSTATA</div>
                        <div style={{ fontWeight: 'bold', fontSize: 'var(--font-size-display-sm)', color: 'var(--text-main)' }}>{Math.round(avgMacrosCalc.totalKcal)}</div>
                    </div>
                </div>
                <div style={{ fontSize: 'var(--font-size-meta)', color: 'var(--text-muted)', textAlign: 'center', marginTop: '10px' }}>
                    Il tuo TDEE viene calcolato automaticamente in base alle tue misurazioni corporee e profilo.
                </div>
            </div>
            
            <div style={{ height: '30px' }}></div>
        </div>
    );
};

export default NutritionPlanning;
