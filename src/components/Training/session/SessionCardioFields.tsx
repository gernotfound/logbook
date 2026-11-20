import { BufferedInput } from '../../UI/BufferedInput';
import { deriveCardioSpeed } from './deriveCardioSpeed';
import type { SessionExerciseSet } from '../../../types';

interface SessionCardioFieldsProps {
    set: SessionExerciseSet;
    exerciseInstanceId: string;
    exIndex: number;
    onUpdateSet: (exIndex: number, setId: string, field: string, value: unknown) => void;
}

export default function SessionCardioFields({ set, exerciseInstanceId, exIndex, onUpdateSet }: SessionCardioFieldsProps) {
    const handleCardioChange = (field: 'time' | 'distance', value: string) => {
        if (!set.id) return;
        onUpdateSet(exIndex, set.id, field, value);
        const speed = deriveCardioSpeed(set, field, value);
        if (speed !== undefined) onUpdateSet(exIndex, set.id, 'speed', speed);
    };

    return (
                <div style={{ background: 'var(--surface-light)', padding: '15px', borderRadius: '12px', border: '1px solid var(--glass-border)', marginTop: '10px' }}>
                    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '10px', marginBottom: '10px' }}>
                        <div>
                            <label className="text-muted text-xs mb-4 block" htmlFor={`cardio-time-${exerciseInstanceId}-${set.id}`}>Durata (min)</label>
                            <BufferedInput 
                                id={`cardio-time-${exerciseInstanceId}-${set.id}`}
                                type="text" 
                                inputMode="decimal"
                                value={set.time || ''} 
                                onChange={val => handleCardioChange('time', val)}
                                placeholder="es. 30"
                                className="w-full bg-black-20 border-glass text-white p-8 rounded-8"
                                style={{ fontSize: '16px', boxSizing: 'border-box' }}
                            />
                        </div>
                        <div>
                            <label className="text-muted text-xs mb-4 block" htmlFor={`cardio-distance-${exerciseInstanceId}-${set.id}`}>Distanza (km)</label>
                            <BufferedInput 
                                id={`cardio-distance-${exerciseInstanceId}-${set.id}`}
                                type="text" 
                                inputMode="decimal"
                                value={set.distance || ''} 
                                onChange={val => handleCardioChange('distance', val)}
                                placeholder="es. 5.2"
                                className="w-full bg-black-20 border-glass text-white p-8 rounded-8"
                                style={{ fontSize: '16px', boxSizing: 'border-box' }}
                            />
                        </div>
                        <div>
                            <label className="text-muted text-xs mb-4 block" htmlFor={`cardio-speed-${exerciseInstanceId}-${set.id}`}>Velocità media</label>
                            <BufferedInput 
                                id={`cardio-speed-${exerciseInstanceId}-${set.id}`}
                                type="text" 
                                inputMode="decimal"
                                value={set.speed || ''} 
                                onChange={val => { const id = set.id; if (id) onUpdateSet(exIndex, id, 'speed', val); }}
                                placeholder="es. 10.5"
                                className="w-full bg-black-20 border-glass text-white p-8 rounded-8"
                                style={{ fontSize: '16px', boxSizing: 'border-box' }}
                            />
                        </div>
                        <div>
                            <label className="text-muted text-xs mb-4 block" htmlFor={`cardio-incline-${exerciseInstanceId}-${set.id}`}>Inclinazione (%)</label>
                            <BufferedInput 
                                id={`cardio-incline-${exerciseInstanceId}-${set.id}`}
                                type="text" 
                                inputMode="decimal"
                                value={set.incline || ''} 
                                onChange={val => { const id = set.id; if (id) onUpdateSet(exIndex, id, 'incline', val); }}
                                placeholder="es. 2.0"
                                className="w-full bg-black-20 border-glass text-white p-8 rounded-8"
                                style={{ fontSize: '16px', boxSizing: 'border-box' }}
                            />
                        </div>
                    </div>
                    <div>
                        <label className="text-muted text-xs mb-4 block" htmlFor={`cardio-kcal-${exerciseInstanceId}-${set.id}`}>Kcal stimate</label>
                        <BufferedInput 
                            id={`cardio-kcal-${exerciseInstanceId}-${set.id}`}
                            type="text" 
                            inputMode="decimal"
                            value={set.kcal || ''} 
                            onChange={val => { const id = set.id; if (id) onUpdateSet(exIndex, id, 'kcal', val); }}
                            placeholder="es. 350"
                            className="w-full bg-black-20 border-glass text-white p-8 rounded-8"
                            style={{ fontSize: '16px', boxSizing: 'border-box' }}
                        />
                    </div>
                </div>
    );
}
