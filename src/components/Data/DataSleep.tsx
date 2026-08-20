import React from 'react';
import { Logic } from '../../lib/logic';

interface DataSleepProps {
    sleepHook: any;
}

const DataSleep: React.FC<DataSleepProps> = ({ sleepHook }) => {
    const todayDateStr = Logic.getLocalDateString();

    const isEditing = !!sleepHook.editingDate;
    const displayDate = sleepHook.editingDate || todayDateStr;

    return (
        <div className="card" id="sleep-form-card" style={isEditing ? { border: '2px solid var(--primary-color)' } : undefined}>
            <h2 style={{ color: isEditing ? 'var(--primary-color)' : 'white', fontSize: '1.2rem', marginBottom: '10px' }}>
                {isEditing ? `✏️ Modifica sonno (${displayDate})` : `🌙 Dati Sonno (${displayDate})`}
            </h2>
            <p style={{ fontSize: '0.85rem', color: 'var(--text-muted)', marginBottom: '20px' }}>
                Registra la durata e la qualità del tuo sonno.
            </p>

            <div style={{ display: 'flex', gap: '15px', marginBottom: '20px', justifyContent: 'center' }}>
                <div style={{ flex: 1, minWidth: 0, maxWidth: '200px' }}>
                    <label style={{ fontSize: '0.85rem', color: 'var(--text-muted)', display: 'block', marginBottom: '8px', textAlign: 'center' }}>Ore Sonno (Totali) *</label>
                    <input 
                        id="sleep-hours" 
                        type="number" 
                        inputMode="decimal"
                        step="0.1" 
                        placeholder="es. 7.5" 
                        value={sleepHook.sleepHours} 
                        onChange={e => sleepHook.setSleepHours(e.target.value)} 
                        onFocus={e => e.target.select()}
                        style={{ width: '100%', boxSizing: 'border-box', textAlign: 'center', fontWeight: 'bold', fontSize: '16px', padding: '10px', margin: 0 }}
                    />
                </div>
            </div>

            <div style={{ width: '100%', height: '1px', background: 'var(--glass-border)', margin: '20px 0' }}></div>
            <h3 style={{ fontSize: '1rem', color: 'var(--text-muted)', marginBottom: '15px' }}>Dettagli fasi (Opzionali)</h3>

            <div className="input-row" style={{ marginBottom: '15px', display: 'flex', gap: '12px' }}>
                <div style={{ flex: 1, minWidth: 0 }}>
                    <label style={{ fontSize: '0.8rem', color: 'var(--text-muted)', display: 'block', marginBottom: '4px', textAlign: 'center' }}>Sonno Profondo (h)</label>
                    <input 
                        id="sleep-deep" 
                        type="number" 
                        inputMode="decimal"
                        step="0.1" 
                        value={sleepHook.sleepDeep} 
                        onChange={e => sleepHook.setSleepDeep(e.target.value)} 
                        onFocus={e => e.target.select()}
                        style={{ width: '100%', boxSizing: 'border-box', textAlign: 'center', margin: '0 auto', fontSize: '16px' }}
                    />
                </div>
                <div style={{ flex: 1, minWidth: 0 }}>
                    <label style={{ fontSize: '0.8rem', color: 'var(--text-muted)', display: 'block', marginBottom: '4px', textAlign: 'center' }}>Sonno Leggero (h)</label>
                    <input 
                        id="sleep-light" 
                        type="number" 
                        inputMode="decimal"
                        step="0.1" 
                        value={sleepHook.sleepLight} 
                        onChange={e => sleepHook.setSleepLight(e.target.value)} 
                        onFocus={e => e.target.select()}
                        style={{ width: '100%', boxSizing: 'border-box', textAlign: 'center', margin: '0 auto', fontSize: '16px' }}
                    />
                </div>
            </div>

            <div className="input-row" style={{ marginBottom: '15px', display: 'flex', gap: '12px' }}>
                <div style={{ flex: 1, minWidth: 0 }}>
                    <label style={{ fontSize: '0.8rem', color: 'var(--text-muted)', display: 'block', marginBottom: '4px', textAlign: 'center' }}>Sonno REM (h)</label>
                    <input 
                        id="sleep-rem" 
                        type="number" 
                        inputMode="decimal"
                        step="0.1" 
                        value={sleepHook.sleepRem} 
                        onChange={e => sleepHook.setSleepRem(e.target.value)} 
                        onFocus={e => e.target.select()}
                        style={{ width: '100%', boxSizing: 'border-box', textAlign: 'center', margin: '0 auto', fontSize: '16px' }}
                    />
                </div>
                <div style={{ flex: 1, minWidth: 0 }}>
                    <label style={{ fontSize: '0.8rem', color: 'var(--text-muted)', display: 'block', marginBottom: '4px', textAlign: 'center' }}>Tempo Sveglio (h)</label>
                    <input 
                        id="sleep-awake" 
                        type="number" 
                        inputMode="decimal"
                        step="0.1" 
                        value={sleepHook.sleepAwake} 
                        onChange={e => sleepHook.setSleepAwake(e.target.value)} 
                        onFocus={e => e.target.select()}
                        style={{ width: '100%', boxSizing: 'border-box', textAlign: 'center', margin: '0 auto', fontSize: '16px' }}
                    />
                </div>
            </div>

            <div style={{ display: 'flex', gap: '10px', marginTop: '25px' }}>
                {isEditing && (
                    <button className="btn" style={{ flex: 1, background: 'rgba(255,255,255,0.1)' }} onClick={() => sleepHook.setEditingDate(null)}>
                        Annulla
                    </button>
                )}
                <button className="btn btn-primary" style={{ flex: 2 }} onClick={sleepHook.saveSleep}>
                    {isEditing ? '💾 Salva modifiche' : '💾 Salva sonno'}
                </button>
            </div>
        </div>
    );
};

export default DataSleep;
