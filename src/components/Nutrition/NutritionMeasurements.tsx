import { useNutritionMeasurements } from '../../hooks/useNutritionMeasurements';

const NutritionMeasurements = () => {
    const {
        profile,
        weight, setWeight,
        waist, setWaist,
        neck, setNeck,
        hip, setHip,
        manualBf, setManualBf,
        method, setMethod,
        calculateAndSave
    } = useNutritionMeasurements();

    return (
        <div className="card" id="measurement-form-card">
            <h3>📏 Nuova Misurazione</h3>
            <p style={{ fontSize: '0.85rem', color: 'var(--text-muted)', marginBottom: '15px' }}>
                Registra il peso e la percentuale di massa grassa.
            </p>
            
            <div style={{ marginBottom: '15px' }}>
                <label style={{ fontSize: '0.8rem', color: 'var(--text-muted)', display: 'block', marginBottom: '4px' }}>Metodo calcolo BF</label>
                <select value={method} onChange={e => setMethod(e.target.value)} style={{ width: '100%', padding: '10px', background: 'var(--surface-color)', color: 'white', border: '1px solid var(--glass-border)', borderRadius: '8px' }}>
                    <option value={profile.gender === 'F' ? 'navy_female' : 'navy_male'}>US Navy (Misurazioni)</option>
                    <option value="manual">Inserimento Manuale</option>
                </select>
            </div>

            <div className="input-row" style={{ marginBottom: '15px' }}>
                <div style={{ flex: 1 }}>
                    <label style={{ fontSize: '0.8rem', color: 'var(--text-muted)' }}>Peso (kg)</label>
                    <input type="number" step="0.1" placeholder="es. 80.5" value={weight} onChange={e => setWeight(e.target.value)} />
                </div>
                {method === 'manual' ? (
                    <div style={{ flex: 1 }}>
                        <label style={{ fontSize: '0.8rem', color: 'var(--text-muted)' }}>BF% Manuale</label>
                        <input type="number" step="0.1" placeholder="es. 15.5" value={manualBf} onChange={e => setManualBf(e.target.value)} />
                    </div>
                ) : (
                    <div style={{ flex: 1 }}>
                        <label style={{ fontSize: '0.8rem', color: 'var(--text-muted)' }}>Vita (cm)</label>
                        <input type="number" step="0.1" value={waist} onChange={e => setWaist(e.target.value)} />
                    </div>
                )}
            </div>

            {method !== 'manual' && (
                <div className="input-row" style={{ marginBottom: '15px' }}>
                    <div style={{ flex: 1 }}>
                        <label style={{ fontSize: '0.8rem', color: 'var(--text-muted)' }}>Collo (cm)</label>
                        <input type="number" step="0.1" value={neck} onChange={e => setNeck(e.target.value)} />
                    </div>
                    {(profile.gender === 'F' || method === 'navy_female') && (
                        <div style={{ flex: 1 }}>
                            <label style={{ fontSize: '0.8rem', color: 'var(--text-muted)' }}>Fianchi (cm)</label>
                            <input type="number" step="0.1" value={hip} onChange={e => setHip(e.target.value)} />
                        </div>
                    )}
                </div>
            )}

            <button className="btn btn-primary" style={{ width: '100%', marginTop: '10px' }} onClick={calculateAndSave}>
                💾 Salva Misurazione
            </button>
        </div>
    );
};

export default NutritionMeasurements;
