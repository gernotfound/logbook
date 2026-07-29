import { useNutritionMeasurements } from '../../hooks/useNutritionMeasurements';

const NutritionMeasurements = () => {
    const {
        profile,
        editingDate,
        measureTime, setMeasureTime,
        weight, setWeight,
        waist, setWaist,
        neck, setNeck,
        hip, setHip,
        manualBf, setManualBf,
        method, setMethod,
        measurementsHistory,
        handleEditClick,
        handleCancelEdit,
        calculateAndSave
    } = useNutritionMeasurements();

    return (
        <div className="nutrition-sub-view active">
            <div className="card" id="measurement-form-card" style={editingDate ? { border: '2px solid var(--primary-color)' } : undefined}>
                <h3 style={{ color: editingDate ? 'var(--primary-color)' : 'white' }}>
                    {editingDate ? `✏️ Modifica Misurazione (${editingDate})` : '📏 Nuova Misurazione'}
                </h3>
                <p style={{ fontSize: '0.85rem', color: 'var(--text-muted)', marginBottom: '15px' }}>
                    Registra il peso e la percentuale di massa grassa.
                </p>
                
                <div style={{ marginBottom: '15px' }}>
                    <label style={{ fontSize: '0.8rem', color: 'var(--text-muted)', display: 'block', marginBottom: '4px' }}>Orario</label>
                    <input type="time" value={measureTime} onChange={e => setMeasureTime(e.target.value)} style={{ width: '100%', padding: '10px', background: 'var(--surface-color)', color: 'white', border: '1px solid var(--glass-border)', borderRadius: '8px', boxSizing: 'border-box', fontSize: '16px', fontFamily: 'inherit' }} />
                </div>

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

                <div style={{ display: 'flex', gap: '10px', marginTop: '20px' }}>
                    {editingDate && (
                        <button className="btn" style={{ flex: 1, background: 'rgba(255,255,255,0.1)' }} onClick={handleCancelEdit}>
                            Annulla
                        </button>
                    )}
                    <button className="btn btn-primary" style={{ flex: 2 }} onClick={calculateAndSave}>
                        {editingDate ? '💾 Salva Modifiche' : '💾 Salva Misurazione'}
                    </button>
                </div>
            </div>

            <h3 style={{ marginTop: '20px' }}>Archivio Misurazioni ({measurementsHistory.length})</h3>
            <p style={{ fontSize: '0.8rem', color: 'var(--text-muted)' }}>Clicca su una misurazione per modificarla.</p>
            {measurementsHistory.length === 0 ? (
                <p style={{ color: 'var(--text-muted)' }}>Nessuna misurazione registrata.</p>
            ) : (
                <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
                    {measurementsHistory.map((day: any) => (
                        <div 
                            key={day.date} 
                            className="card" 
                            style={{ 
                                padding: '15px', 
                                marginBottom: 0, 
                                display: 'flex', 
                                justifyContent: 'space-between', 
                                alignItems: 'center', 
                                cursor: 'pointer',
                                borderLeft: editingDate === day.date ? '3px solid var(--primary-color)' : 'none'
                            }}
                            onClick={() => handleEditClick(day)}
                        >
                            <div>
                                <div style={{ fontWeight: 'bold', color: editingDate === day.date ? 'var(--primary-color)' : 'white' }}>
                                    {day.date} {day.measurementTime ? `alle ${day.measurementTime}` : ''}
                                </div>
                                <div style={{ fontSize: '0.85rem', color: 'var(--text-muted)', marginTop: '4px' }}>
                                    {day.weight && <span>Peso: {day.weight} kg </span>}
                                    {day.bf && <span>| BF: {day.bf}%</span>}
                                </div>
                            </div>
                        </div>
                    ))}
                </div>
            )}
        </div>
    );
};

export default NutritionMeasurements;
