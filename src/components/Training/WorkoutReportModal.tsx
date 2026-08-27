import React, { useMemo } from 'react';
import { X, Trophy, Star, ArrowUp, ArrowDown, Activity, Clock, Layers } from 'lucide-react';
import { computeWorkoutReport } from '../../lib/calc/workoutReport';
import { Logic } from '../../lib/logic';
import type { WorkoutSession, Exercise } from '../../types';

interface WorkoutReportModalProps {
    workout: WorkoutSession;
    history: WorkoutSession[];
    library: Exercise[];
    onClose: () => void;
    fromEndWorkout?: boolean;
}

const WorkoutReportModal: React.FC<WorkoutReportModalProps> = ({ workout, history, library, onClose, fromEndWorkout }) => {
    
    const report = useMemo(() => {
        const libraryMap = new Map(library.map(l => [l.id, l]));
        return computeWorkoutReport(workout, history, libraryMap);
    }, [workout, history, library]);

    const formatKg = (val: number) => {
        if (val >= 1000) return `${(val / 1000).toFixed(2)} t`;
        return `${val.toFixed(1).replace(/\.0$/, '')} kg`;
    };

    const formatDelta = (val: number, isPercent = false) => {
        const prefix = val > 0 ? '+' : '';
        const num = val.toFixed(1).replace(/\.0$/, '');
        return `${prefix}${num}${isPercent ? '%' : ''}`;
    };

    return (
        <div style={{
            position: 'fixed',
            top: 0, left: 0, right: 0, bottom: 0,
            background: 'rgba(0, 0, 0, 0.85)',
            backdropFilter: 'blur(10px)',
            WebkitBackdropFilter: 'blur(10px)',
            zIndex: 9999,
            display: 'flex',
            flexDirection: 'column',
            animation: 'fadeIn 0.3s ease-out',
            overflow: 'hidden'
        }}>
            <div style={{
                background: 'var(--surface-color)',
                width: '100%',
                maxWidth: '600px',
                margin: 'auto',
                height: '100%',
                maxHeight: '100vh',
                display: 'flex',
                flexDirection: 'column',
                position: 'relative'
            }}>
                {/* Header */}
                <div style={{
                    padding: '20px',
                    borderBottom: '1px solid var(--glass-border)',
                    display: 'flex',
                    flexDirection: 'column',
                    gap: '10px'
                }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
                        <div>
                            <h2 style={{ margin: 0, fontSize: '1.4rem', color: 'var(--text-main)' }}>{report.workoutName}</h2>
                            <p style={{ margin: '4px 0 0', fontSize: '0.85rem', color: 'var(--text-muted)' }}>
                                {Logic.formatItalianDate ? Logic.formatItalianDate(report.date) : report.date}
                            </p>
                        </div>
                        <button onClick={onClose} style={{ background: 'transparent', border: 'none', color: 'var(--text-muted)', cursor: 'pointer', padding: '4px' }}>
                            <X size={24} />
                        </button>
                    </div>
                    <div style={{ display: 'flex', gap: '10px' }}>
                        <span style={{ fontSize: '0.75rem', background: 'rgba(255,255,255,0.08)', padding: '4px 8px', borderRadius: '6px', display: 'flex', alignItems: 'center', gap: '4px' }}>
                            <Clock size={12} />
                            {Logic.formatDuration ? Logic.formatDuration(report.durationSeconds) : report.durationSeconds}
                        </span>
                        <span style={{ fontSize: '0.75rem', background: 'rgba(255,255,255,0.08)', padding: '4px 8px', borderRadius: '6px', display: 'flex', alignItems: 'center', gap: '4px' }}>
                            <Layers size={12} />
                            {workout.exercises?.length || 0} Esercizi
                        </span>
                    </div>
                </div>

                {/* Content */}
                <div style={{ flex: 1, overflowY: 'auto', padding: '20px', display: 'flex', flexDirection: 'column', gap: '20px' }}>
                    
                    {/* Summary Cards */}
                    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px' }}>
                        <div className="card" style={{ margin: 0, padding: '16px', display: 'flex', flexDirection: 'column', gap: '8px' }}>
                            <span style={{ fontSize: '0.8rem', color: 'var(--text-muted)' }}>Volume Totale</span>
                            <span style={{ fontSize: '1.4rem', fontWeight: 'bold', color: 'var(--primary-color)' }}>{formatKg(report.totalVolume)}</span>
                            {report.volumeDeltaPercent !== undefined && report.volumeDeltaPercent !== 0 && (
                                <span style={{
                                    fontSize: '0.75rem',
                                    fontWeight: 'bold',
                                    color: report.volumeDeltaPercent > 0 ? 'var(--success-color)' : 'var(--danger-color)',
                                    display: 'flex', alignItems: 'center', gap: '2px'
                                }}>
                                    {report.volumeDeltaPercent > 0 ? <ArrowUp size={12} /> : <ArrowDown size={12} />}
                                    {formatDelta(Math.abs(report.volumeDeltaPercent), true)} vs prec.
                                </span>
                            )}
                        </div>
                        <div className="card" style={{ margin: 0, padding: '16px', display: 'flex', flexDirection: 'column', gap: '8px', justifyContent: 'center' }}>
                             <span style={{ fontSize: '0.8rem', color: 'var(--text-muted)' }}>Esercizi Condivisi</span>
                             <span style={{ fontSize: '1.4rem', fontWeight: 'bold', color: 'var(--text-main)' }}>{report.exerciseComparisons.length}</span>
                        </div>
                    </div>

                    {report.isFirstSession ? (
                        <div style={{
                            background: 'rgba(0, 229, 255, 0.1)',
                            border: '1px solid rgba(0, 229, 255, 0.2)',
                            borderRadius: '12px',
                            padding: '20px',
                            textAlign: 'center',
                            display: 'flex',
                            flexDirection: 'column',
                            alignItems: 'center',
                            gap: '10px'
                        }}>
                            <span style={{ fontSize: '2rem' }}>🎉</span>
                            <h3 style={{ margin: 0, fontSize: '1.1rem', color: 'var(--primary-color)' }}>Prima sessione completata!</h3>
                            <p style={{ margin: 0, fontSize: '0.85rem', color: 'var(--text-muted)' }}>Non abbiamo allenamenti precedenti con questa scheda per fare un confronto. I progressi verranno tracciati dalla prossima volta!</p>
                        </div>
                    ) : (
                        <>
                            {/* PR Section */}
                            {report.newPRs.length > 0 && (
                                <div className="card" style={{ margin: 0, padding: '16px', background: 'rgba(234, 179, 8, 0.05)', border: '1px solid rgba(234, 179, 8, 0.2)' }}>
                                    <h3 style={{ margin: '0 0 12px', fontSize: '1rem', color: 'var(--warning-color)', display: 'flex', alignItems: 'center', gap: '6px' }}>
                                        <Trophy size={16} /> Nuovi Record Personali
                                    </h3>
                                    <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                                        {report.newPRs.map(pr => (
                                            <div key={pr.exId} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', fontSize: '0.9rem' }}>
                                                <span>{pr.exName}</span>
                                                <span style={{ fontWeight: 'bold', color: 'var(--warning-color)' }}>
                                                    {pr.volumeDeltaPercent > 0 ? `+${pr.volumeDeltaPercent.toFixed(1)}% Vol` : `+${pr.weightDelta.toFixed(1)}kg Media`}
                                                </span>
                                            </div>
                                        ))}
                                    </div>
                                </div>
                            )}

                            {/* Star Exercise */}
                            {report.starExercise && (
                                <div className="card" style={{ margin: 0, padding: '16px', background: 'rgba(0, 229, 255, 0.05)', border: '1px solid rgba(0, 229, 255, 0.2)' }}>
                                    <h3 style={{ margin: '0 0 8px', fontSize: '1rem', color: 'var(--primary-color)', display: 'flex', alignItems: 'center', gap: '6px' }}>
                                        <Star size={16} /> Miglioramento Top
                                    </h3>
                                    <p style={{ margin: 0, fontSize: '0.9rem' }}>
                                        <span style={{ fontWeight: 'bold' }}>{report.starExercise.exName}</span>: {formatDelta(report.starExercise.volumeDeltaPercent, true)} volume
                                    </p>
                                </div>
                            )}

                            {/* Exercise List */}
                            {report.exerciseComparisons.length > 0 && (
                                <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
                                    <h3 style={{ margin: 0, fontSize: '1.1rem', color: 'var(--text-main)', display: 'flex', alignItems: 'center', gap: '6px' }}>
                                        <Activity size={16} /> Confronto Esercizi
                                    </h3>
                                    {report.exerciseComparisons.map(ex => {
                                        const maxVol = Math.max(ex.currentVolume, ex.previousVolume);
                                        const currWidth = maxVol > 0 ? (ex.currentVolume / maxVol) * 100 : 0;
                                        const prevWidth = maxVol > 0 ? (ex.previousVolume / maxVol) * 100 : 0;

                                        return (
                                            <div key={ex.exId} className="card" style={{ margin: 0, padding: '16px', display: 'flex', flexDirection: 'column', gap: '12px' }}>
                                                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                                                    <span style={{ fontWeight: 'bold', fontSize: '0.95rem' }}>{ex.exName}</span>
                                                    {ex.isPR && <span style={{ background: 'var(--warning-color)', color: '#000', fontSize: '0.65rem', padding: '2px 6px', borderRadius: '4px', fontWeight: 'bold' }}>PR</span>}
                                                </div>

                                                <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
                                                    {/* Previous Bar */}
                                                    <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                                                        <span style={{ fontSize: '0.75rem', color: 'var(--text-muted)', width: '35px' }}>Prec.</span>
                                                        <div style={{ flex: 1, height: '6px', background: 'rgba(255,255,255,0.05)', borderRadius: '3px', overflow: 'hidden' }}>
                                                            <div style={{ width: `${prevWidth}%`, height: '100%', background: 'var(--text-muted)' }} />
                                                        </div>
                                                        <span style={{ fontSize: '0.75rem', color: 'var(--text-muted)', width: '50px', textAlign: 'right' }}>{formatKg(ex.previousVolume)}</span>
                                                    </div>
                                                    
                                                    {/* Current Bar */}
                                                    <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                                                        <span style={{ fontSize: '0.75rem', color: 'var(--text-main)', width: '35px' }}>Oggi</span>
                                                        <div style={{ flex: 1, height: '6px', background: 'rgba(255,255,255,0.05)', borderRadius: '3px', overflow: 'hidden' }}>
                                                            <div style={{ width: `${currWidth}%`, height: '100%', background: ex.volumeDelta >= 0 ? 'var(--primary-color)' : 'var(--danger-color)' }} />
                                                        </div>
                                                        <span style={{ fontSize: '0.75rem', color: 'var(--text-main)', width: '50px', textAlign: 'right', fontWeight: 'bold' }}>{formatKg(ex.currentVolume)}</span>
                                                    </div>
                                                </div>

                                                <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.8rem', color: 'var(--text-muted)', borderTop: '1px solid var(--glass-border)', paddingTop: '8px' }}>
                                                    <span>Reps: {ex.currentReps} <span style={{ color: ex.repsDelta > 0 ? 'var(--success-color)' : (ex.repsDelta < 0 ? 'var(--danger-color)' : 'inherit') }}>({formatDelta(ex.repsDelta)})</span></span>
                                                    <span>Peso medio: {formatKg(ex.currentAvgWeight)} <span style={{ color: ex.weightDelta > 0 ? 'var(--success-color)' : (ex.weightDelta < 0 ? 'var(--danger-color)' : 'inherit') }}>({formatDelta(ex.weightDelta)})</span></span>
                                                </div>
                                            </div>
                                        );
                                    })}
                                </div>
                            )}
                        </>
                    )}
                </div>

                {/* Footer */}
                <div style={{ padding: '16px 20px', borderTop: '1px solid var(--glass-border)' }}>
                    <button className="btn btn-primary" style={{ width: '100%', margin: 0, padding: '16px', fontSize: '1.05rem', fontWeight: 'bold' }} onClick={onClose}>
                        {fromEndWorkout ? 'Chiudi e torna alla Home' : 'Chiudi Report'}
                    </button>
                </div>
            </div>
        </div>
    );
};

export default WorkoutReportModal;
