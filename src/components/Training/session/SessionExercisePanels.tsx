import { BufferedInput } from '../../UI/BufferedInput';
import type { SessionExercise, SessionExerciseSet } from '../../../types';

export type SessionExerciseHistoryEntry = { date: string; sets: Partial<SessionExerciseSet>[]; note: string };

interface SessionExerciseHistoryProps {
    exIndex: number;
    pastWorkouts: SessionExerciseHistoryEntry[];
    trackingType?: string;
}

export function SessionExerciseHistory({ exIndex, pastWorkouts, trackingType }: SessionExerciseHistoryProps) {
    return (
        <div id={`session-history-${exIndex}`} style={{ padding: '12px', background: 'var(--surface-light)', borderRadius: '8px', marginBottom: '15px', border: '1px solid var(--glass-border)' }}>
            <div style={{ marginBottom: '8px', fontSize: 'var(--font-size-meta)', fontWeight: 400, color: 'var(--text-muted)' }}>Ultimi 2 allenamenti:</div>
            {pastWorkouts.length === 0 ? (
                <div style={{ fontSize: 'var(--font-size-meta)', color: 'var(--text-muted)' }}>Nessun dato precedente trovato.</div>
            ) : (
                pastWorkouts.map((pw, idx) => (
                    <div key={idx} style={{ marginBottom: '8px', paddingBottom: '8px', borderBottom: '1px dashed var(--glass-border)' }}>
                        <strong style={{ fontSize: 'var(--font-size-meta)', color: 'var(--primary-color)' }}>{pw.date}</strong><br />
                        {pw.sets.map((s, sIdx: number) => {
                            // Salta la serie se entrambi i campi sono assenti (weight_reps)
                            if (trackingType !== 'time' && trackingType !== 'cardio') {
                                const hasKg = s.kg !== null && s.kg !== undefined && s.kg !== '';
                                const hasReps = s.reps !== null && s.reps !== undefined && s.reps !== '';
                                if (!hasKg && !hasReps) return null;
                            }
                                    
                            const displayKg = s.kg !== null && s.kg !== undefined && s.kg !== '' ? s.kg : '?';
                            const displayReps = s.reps !== null && s.reps !== undefined && s.reps !== '' ? s.reps : '?';
                            const displayTime = s.time !== null && s.time !== undefined && s.time !== '' ? s.time : '?';
                            const displayRir = typeof s.rir === 'number' && Number.isInteger(s.rir) && s.rir >= 0 && s.rir <= 10 ? s.rir : undefined;

                            const cardioDetails = trackingType === 'cardio'
                                ? [
                                    s.time ? `${s.time} min` : '',
                                    s.distance ? `${s.distance} km` : '',
                                    s.speed ? `${s.speed} km/h` : '',
                                    s.incline ? `${s.incline}% incl.` : '',
                                    s.kcal ? `${s.kcal} kcal` : '',
                                ].filter(Boolean)
                                : [];

                            return (
                                <span key={sIdx} style={{ fontSize: 'var(--font-size-meta)', marginRight: '15px', display: 'inline-block' }}>
                                    S{sIdx + 1}: {trackingType === 'cardio' ? (
                                        <b>{cardioDetails.length > 0 ? cardioDetails.join(' · ') : 'Nessun dato registrato'}</b>
                                    ) : trackingType === 'time' ? (
                                        <><b>{s.kg ? s.kg + 'kg ' : ''}</b>⏱️ <b>{displayTime}</b></>
                                    ) : (
                                        <><b>{displayKg}</b> kg × <b>{displayReps}</b>{displayRir !== undefined && <> · <b>{displayRir} RIR</b></>}</>
                                    )}
                                </span>
                            );
                        })}
                    </div>
                ))
            )}
        </div>
    );
}

interface SessionExerciseSetupProps {
    exItem: SessionExercise;
    exIndex: number;
    exNotes: string;
    exerciseInstanceId: string;
    onUpdateTechnicalStandard: (exIndex: number, value: string) => void;
    onUpdateSetupNote: (exId: string, note: string) => void;
}

export function SessionExerciseSetup({ exItem, exIndex, exNotes, exerciseInstanceId, onUpdateTechnicalStandard, onUpdateSetupNote }: SessionExerciseSetupProps) {
    return (
        <div id={`session-setup-${exIndex}`} style={{ padding: '12px', background: 'var(--surface-light)', borderRadius: '8px', marginBottom: '15px', border: '1px solid var(--glass-border)' }}>
            <label className="text-muted" style={{ fontSize: 'var(--font-size-meta)', fontWeight: 400 }} htmlFor={`technical-standard-${exerciseInstanceId}`}>Standard tecnico di questa sessione</label>
            <BufferedInput
                id={`technical-standard-${exerciseInstanceId}`}
                type="text"
                value={exItem.technicalStandard || ''}
                placeholder="Es. stesso macchinario, ROM completo, fermo 1 s"
                onChange={value => onUpdateTechnicalStandard(exIndex, value)}
                style={{ margin: '4px 0 10px', width: '100%', fontSize: '16px' }}
            />
            <label className="text-muted" style={{ fontSize: 'var(--font-size-meta)', fontWeight: 400 }} htmlFor={`setup-${exerciseInstanceId}`}>Note esercizio</label>
            <BufferedInput
                id={`setup-${exerciseInstanceId}`}
                recoveryId={`setup-${exItem.exId}`}
                type="text"
                value={exNotes}
                placeholder="Es. altezza sedile abituale"
                onChange={value => onUpdateSetupNote(exItem.exId, value)}
                style={{ margin: '4px 0 0', width: '100%', fontSize: '16px' }}
            />
        </div>
    );
}
