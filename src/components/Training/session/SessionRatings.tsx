import React from 'react';

interface SessionRatingsProps {
    water: string | number;
    setWater: (val: string) => void;
    mood: string | number;
    setMood: (val: string) => void;
    pump: string | number;
    setPump: (val: string) => void;
    fatigue: string | number;
    setFatigue: (val: string) => void;
}

export const SessionRatings: React.FC<SessionRatingsProps> = ({
    water,
    setWater,
    mood,
    setMood,
    pump,
    setPump,
    fatigue,
    setFatigue
}) => {
    return (
        <>
            <div style={{ margin: '20px 0', padding: '15px', background: 'rgba(14, 165, 233, 0.1)', borderRadius: '12px', border: '1px solid var(--primary-color)' }}>
                <label htmlFor="water-intake" style={{ fontSize: '0.85rem', color: 'var(--primary-color)', display: 'block', marginBottom: '8px' }}>
                    💧 Acqua bevuta (Litri)
                </label>
                <input 
                    id="water-intake" 
                    type="number" 
                    step="0.1" 
                    placeholder="es. 1.5" 
                    value={water} 
                    onChange={e => setWater(e.target.value)} 
                    style={{ margin: 0, width: '100%', borderColor: 'var(--primary-color)' }} 
                />
            </div>

            <div style={{ margin: '20px 0', padding: '15px', background: 'rgba(255, 255, 255, 0.05)', borderRadius: '12px', border: '1px solid var(--glass-border)' }}>
                <h4 style={{ marginTop: 0, marginBottom: '12px' }}>Valuta Sessione (1-10) — Opzionale</h4>
                <div style={{ display: 'flex', gap: '10px' }}>
                    <div style={{ flex: 1 }}>
                        <label htmlFor="mood-rating" style={{ fontSize: '0.75rem', color: 'var(--text-muted)', display: 'block', marginBottom: '4px' }}>
                            Umore
                        </label>
                        <input 
                            id="mood-rating" 
                            type="number" 
                            min="1" 
                            max="10" 
                            value={mood} 
                            onChange={e => setMood(e.target.value)} 
                            style={{ margin: 0, textAlign: 'center' }} 
                        />
                    </div>
                    <div style={{ flex: 1 }}>
                        <label htmlFor="pump-rating" style={{ fontSize: '0.75rem', color: 'var(--text-muted)', display: 'block', marginBottom: '4px' }}>
                            Pump
                        </label>
                        <input 
                            id="pump-rating" 
                            type="number" 
                            min="1" 
                            max="10" 
                            value={pump} 
                            onChange={e => setPump(e.target.value)} 
                            style={{ margin: 0, textAlign: 'center' }} 
                        />
                    </div>
                    <div style={{ flex: 1 }}>
                        <label htmlFor="fatigue-rating" style={{ fontSize: '0.75rem', color: 'var(--text-muted)', display: 'block', marginBottom: '4px' }}>
                            Stanchezza
                        </label>
                        <input 
                            id="fatigue-rating" 
                            type="number" 
                            min="1" 
                            max="10" 
                            value={fatigue} 
                            onChange={e => setFatigue(e.target.value)} 
                            style={{ margin: 0, textAlign: 'center' }} 
                        />
                    </div>
                </div>
            </div>
        </>
    );
};

export default SessionRatings;
