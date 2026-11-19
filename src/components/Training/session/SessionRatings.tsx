import React from 'react';
import { Droplets } from 'lucide-react';
import { BufferedInput } from '../../UI/BufferedInput';
import { SessionPainPicker } from './SessionPainPicker';

interface SessionRatingsProps {
    water: string | number;
    setWater: (val: string) => void;
    mood: string | number;
    setMood: (val: string) => void;
    pump: string | number;
    setPump: (val: string) => void;
    fatigue: string | number;
    setFatigue: (val: string) => void;
    pains?: string[];
    onTogglePain?: (muscleId: string) => void;
    onSetPains?: (pains: string[]) => void;
}

export const SessionRatings: React.FC<SessionRatingsProps> = ({
    water,
    setWater,
    mood,
    setMood,
    pump,
    setPump,
    fatigue,
    setFatigue,
    pains = [],
    onTogglePain,
    onSetPains
}) => {
    return (
        <>
            <div style={{ margin: '20px 0', padding: '15px', background: 'var(--primary-soft)', borderRadius: '12px', border: '1px solid var(--primary-color)' }}>
                <label htmlFor="water-intake" style={{ fontSize: 'var(--font-size-meta)', color: 'var(--primary-color)', display: 'flex', alignItems: 'center', gap: '6px', marginBottom: '8px' }}>
                    <Droplets size={16} aria-hidden="true" /> Acqua bevuta (litri)
                </label>
                <BufferedInput 
                    id="water-intake" 
                    type="number" 
                    inputMode="decimal"
                    step="0.1" 
                    placeholder="es. 1.5" 
                    value={water} 
                    onChange={setWater} 
                    onFocus={e => e.target.select()}
                    style={{ margin: 0, width: '100%', borderColor: 'var(--primary-color)', fontSize: '16px' }} 
                />
            </div>

            <div className="post-session-ratings">
                <h3>Valuta sessione</h3>
                {[
                    { label: 'Umore', value: mood, setter: setMood },
                    { label: 'Pump', value: pump, setter: setPump },
                    { label: 'Stanchezza', value: fatigue, setter: setFatigue },
                ].map(metric => (
                    <fieldset className="readiness-metric" key={metric.label}>
                        <legend>{metric.label}</legend>
                        <div className="readiness-scale" role="group" aria-label={`${metric.label}, scala da 1 a 5`}>
                            {Array.from({ length: 5 }, (_, index) => index + 1).map(value => (
                                <button key={value} type="button" className="readiness-value" aria-pressed={String(metric.value) === String(value)} aria-label={`${metric.label}: ${value} su 5`} onClick={() => metric.setter(String(value))}>{value}</button>
                            ))}
                        </div>
                    </fieldset>
                ))}
            </div>

            <SessionPainPicker pains={pains} onTogglePain={onTogglePain} onSetPains={onSetPains} />
        </>
    );
};

export default SessionRatings;
