import React from 'react';

interface DataMeasurementsProps {
    profile: any;
    editingDate: string | null;
    measureTime: string;
    setMeasureTime: (val: string) => void;
    weight: string;
    setWeight: (val: string) => void;
    waist: string;
    setWaist: (val: string) => void;
    neck: string;
    setNeck: (val: string) => void;
    hip: string;
    setHip: (val: string) => void;
    manualBf: string;
    setManualBf: (val: string) => void;
    method: string;
    setMethod: (val: string) => void;
    handleCancelEdit: () => void;
    calculateAndSave: () => Promise<void>;
}

const DataMeasurements: React.FC<DataMeasurementsProps> = ({
    profile,
    editingDate,
    measureTime, setMeasureTime,
    weight, setWeight,
    waist, setWaist,
    neck, setNeck,
    hip, setHip,
    manualBf, setManualBf,
    method, setMethod,
    handleCancelEdit,
    calculateAndSave
}) => {
    return (
        <div className="card" id="measurement-form-card" style={editingDate ? { border: '2px solid var(--primary-color)' } : undefined}>
            <h3 style={{ color: editingDate ? 'var(--primary-color)' : 'white' }}>
                {editingDate ? `✏️ Modifica Misurazione (${editingDate})` : '📏 Nuova Misurazione'}
            </h3>
            <p style={{ fontSize: '0.85rem', color: 'var(--text-muted)', marginBottom: '15px' }}>
                Registra il peso e la percentuale di massa grassa.
            </p>
            
            <div className="mb-15" style={{ width: '100%', boxSizing: 'border-box' }}>
                <label className="text-muted text-xs block mb-4" style={{ textAlign: 'center' }}>Orario</label>
                <div style={{ display: 'flex', justifyContent: 'center', width: '100%' }}>
                    <input 
                        id="measure-time" 
                        type="time" 
                        value={measureTime} 
                        onChange={e => setMeasureTime(e.target.value)} 
                        style={{
                            width: '100%',
                            maxWidth: '100%',
                            boxSizing: 'border-box',
                            textAlign: 'center',
                            margin: '0 auto',
                            display: 'block'
                        }}
                    />
                </div>
            </div>

            <div className="mb-15" style={{ width: '100%', boxSizing: 'border-box' }}>
                <label className="text-muted text-xs block mb-4" style={{ textAlign: 'center' }}>Metodo calcolo BF</label>
                <select 
                    value={method} 
                    onChange={e => setMethod(e.target.value)}
                    style={{
                        width: '100%',
                        maxWidth: '100%',
                        boxSizing: 'border-box',
                        textAlign: 'center',
                        margin: '0 auto',
                        display: 'block'
                    }}
                >
                    <option value={profile.gender === 'F' ? 'navy_female' : 'navy_male'}>US Navy (Misurazioni)</option>
                    <option value="manual">Inserimento Manuale</option>
                </select>
            </div>

            <div className="input-row" style={{ marginBottom: '15px', display: 'flex', gap: '12px' }}>
                <div style={{ flex: 1, minWidth: 0 }}>
                    <label style={{ fontSize: '0.8rem', color: 'var(--text-muted)', display: 'block', marginBottom: '4px', textAlign: 'center' }}>Peso (kg)</label>
                    <input 
                        id="measure-weight" 
                        type="number" 
                        step="0.1" 
                        placeholder="es. 80.5" 
                        value={weight} 
                        onChange={e => setWeight(e.target.value)} 
                        onFocus={e => e.target.select()}
                        style={{ width: '100%', boxSizing: 'border-box', textAlign: 'center', margin: '0 auto' }}
                    />
                </div>
                {method === 'manual' ? (
                    <div style={{ flex: 1, minWidth: 0 }}>
                        <label style={{ fontSize: '0.8rem', color: 'var(--text-muted)', display: 'block', marginBottom: '4px', textAlign: 'center' }}>BF% Manuale</label>
                        <input 
                            id="measure-bf" 
                            type="number" 
                            step="0.1" 
                            placeholder="es. 15.5" 
                            value={manualBf} 
                            onChange={e => setManualBf(e.target.value)} 
                            onFocus={e => e.target.select()}
                            style={{ width: '100%', boxSizing: 'border-box', textAlign: 'center', margin: '0 auto' }}
                        />
                    </div>
                ) : (
                    <div style={{ flex: 1, minWidth: 0 }}>
                        <label style={{ fontSize: '0.8rem', color: 'var(--text-muted)', display: 'block', marginBottom: '4px', textAlign: 'center' }}>Vita (cm)</label>
                        <input 
                            id="measure-waist" 
                            type="number" 
                            step="0.1" 
                            value={waist} 
                            onChange={e => setWaist(e.target.value)} 
                            onFocus={e => e.target.select()}
                            style={{ width: '100%', boxSizing: 'border-box', textAlign: 'center', margin: '0 auto' }}
                        />
                    </div>
                )}
            </div>

            {method !== 'manual' && (
                <div className="input-row" style={{ marginBottom: '15px', display: 'flex', gap: '12px' }}>
                    <div style={{ flex: 1, minWidth: 0 }}>
                        <label style={{ fontSize: '0.8rem', color: 'var(--text-muted)', display: 'block', marginBottom: '4px', textAlign: 'center' }}>Collo (cm)</label>
                        <input 
                            id="measure-neck" 
                            type="number" 
                            step="0.1" 
                            value={neck} 
                            onChange={e => setNeck(e.target.value)} 
                            onFocus={e => e.target.select()}
                            style={{ width: '100%', boxSizing: 'border-box', textAlign: 'center', margin: '0 auto' }}
                        />
                    </div>
                    {(profile.gender === 'F' || method === 'navy_female') && (
                        <div style={{ flex: 1, minWidth: 0 }}>
                            <label style={{ fontSize: '0.8rem', color: 'var(--text-muted)', display: 'block', marginBottom: '4px', textAlign: 'center' }}>Fianchi (cm)</label>
                            <input 
                                id="measure-hip" 
                                type="number" 
                                step="0.1" 
                                value={hip} 
                                onChange={e => setHip(e.target.value)} 
                                onFocus={e => e.target.select()}
                                style={{ width: '100%', boxSizing: 'border-box', textAlign: 'center', margin: '0 auto' }}
                            />
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
    );
};

export default DataMeasurements;
