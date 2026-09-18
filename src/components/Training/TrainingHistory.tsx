import { useMemo, useState } from 'react';
import { Virtuoso } from 'react-virtuoso';
import { BarChart2, Pencil, Trash2 } from 'lucide-react';
import { ContextMenu } from '../UI/ContextMenu';
import { useTrainingHistory } from '../../hooks/useTrainingHistory';
import { Logic } from '../../lib/logic';
import type { WorkoutSession } from '../../types';
import WorkoutReportModal from './WorkoutReportModal';

interface TrainingHistoryProps {
    onEditWorkout?: (workout: WorkoutSession) => void;
}

const TrainingHistory = ({ onEditWorkout }: TrainingHistoryProps) => {
    const { userData, history, deleteWorkout } = useTrainingHistory();
    const [selectedReportWorkout, setSelectedReportWorkout] = useState<WorkoutSession | null>(null);

    const library = useMemo(() => userData?.library || [], [userData?.library]);
    const libraryMap = useMemo(() => {
        const map = new Map<string, any>();
        library.forEach(l => map.set(l.id, l));
        return map;
    }, [library]);

    return (
        <div className="training-sub-view active">
            {selectedReportWorkout && (
                <WorkoutReportModal
                    workout={selectedReportWorkout}
                    history={history}
                    library={library}
                    onClose={() => setSelectedReportWorkout(null)}
                    fromEndWorkout={false}
                />
            )}

            <h2 style={{marginBottom: '20px'}}>Storico allenamenti ({history.length})</h2>

            {history.length === 0 ? (
                <p style={{ color: 'var(--text-muted)' }}>Nessun allenamento registrato.</p>
            ) : (
                <div style={{ display: 'flex', flexDirection: 'column' }}>
                    <Virtuoso
                        useWindowScroll
                        data={history}
                        initialItemCount={Math.min(10, history.length)}
                        components={{
                            Footer: () => <div style={{ height: '90px' }} />
                        }}
                        itemContent={(_, wo) => {
                        if (!wo) return null;
                        let dateObj: Date;
                        if (wo.globalStartTime) {
                            dateObj = new Date(wo.globalStartTime);
                        } else if (wo.date) {
                            const validStr = Logic.parseDateInput(wo.date) || wo.date;
                            const [y, m, d] = validStr.split('-').map(Number);
                            dateObj = (y && m && d) ? new Date(y, m - 1, d) : new Date();
                        } else {
                            dateObj = new Date();
                        }
                        const date = dateObj.toLocaleDateString('it-IT', {
                            weekday: 'short', day: '2-digit', month: 'short', year: 'numeric'
                        });
                        const rawDuration = wo.manualDurationStr
                            || wo.globalDurationStr
                            || ((wo.globalEndTime && wo.globalStartTime)
                                ? Logic.formatDuration(Math.max(0, Math.floor((wo.globalEndTime - wo.globalStartTime) / 1000)))
                                : '00:00:00');
                        const durationDisplay = Logic.normalizeDuration(rawDuration);

                        const moodVal = wo.moodRating ?? (wo as any).mood;
                        const pumpVal = wo.pumpRating ?? (wo as any).pump;
                        const fatigueVal = wo.fatigueRating ?? (wo as any).fatigue;
                        const hasRatings = moodVal || pumpVal || fatigueVal;

                        return (
                            <div key={wo.id} className="card" style={{ marginBottom: '15px', borderLeft: '4px solid var(--primary-dark)' }}>
                                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: '10px' }}>
                                    <div>
                                        <h3 style={{margin: 0}}>{wo.routineName || 'Sessione personalizzata'}</h3>
                                        <div style={{  color: 'var(--text-muted)' }} className="text-sm">{date}</div>
                                    </div>
                                    <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
                                        <div className="badge badge-primary" style={{ marginRight: '5px' }}>{durationDisplay}</div>
                                        <ContextMenu
                                            items={[
                                                {
                                                    label: 'Vedi report',
                                                    icon: <BarChart2 size={16} />,
                                                    onClick: () => setSelectedReportWorkout(wo)
                                                },
                                                {
                                                    label: 'Modifica allenamento',
                                                    icon: <Pencil size={16} />,
                                                    hidden: !onEditWorkout,
                                                    onClick: () => onEditWorkout?.(wo)
                                                },
                                                {
                                                    label: 'Elimina allenamento',
                                                    icon: <Trash2 size={16} />,
                                                    variant: 'danger',
                                                    onClick: () => deleteWorkout(wo.id!)
                                                }
                                            ]}
                                        />
                                    </div>
                                </div>

                                <div style={{  color: 'var(--text-muted)', marginBottom: '10px' }} className="text-sm">
                                    <div>
                                        {wo.exercises?.length || 0} esercizi completati
                                        {(wo.waterLiters || 0) > 0 && <span style={{ marginLeft: '15px', color: 'var(--primary-color)' }}>💧 {wo.waterLiters}L</span>}
                                    </div>
                                </div>

                                {(wo.exercises || []).length > 0 && (
                                    <div style={{ marginBottom: '10px' }}>
                                        {(wo.exercises || []).map((ex: any, exIdx: number) => {
                                            const libDef = libraryMap.get(ex.exId);
                                            const exName = libDef ? libDef.name : (ex.name || 'Esercizio rimosso');

                                            const validSets = (ex.sets || []).filter((s: any) => s.kg || s.reps || s.time || s.distance || s.speed || s.kcal);
                                            return (
                                                <div key={exIdx} style={{  color: 'var(--text-muted)', marginBottom: '2px' }} className="text-sm">
                                                    <span style={{ color: 'var(--text-main)', fontWeight: '500' }}>{exName}</span>
                                                    {validSets.length > 0 && (
                                                        <span> — {validSets.map((s: any) => {
                                                            if (libDef?.trackingType === 'cardio') {
                                                                const parts = [];
                                                                if (s.time) parts.push(`${s.time}m`);
                                                                if (s.distance) parts.push(`${s.distance}km`);
                                                                if (s.speed) parts.push(`${s.speed}km/h`);
                                                                if (s.kcal) parts.push(`${s.kcal}kcal`);
                                                                return parts.join(' • ') || 'Cardio';
                                                            }
                                                        if (libDef?.trackingType === 'time') {
                                                            const displayKg = s.kg !== null && s.kg !== undefined && s.kg !== '' ? s.kg + 'kg ' : '';
                                                            const displayTime = s.time !== null && s.time !== undefined && s.time !== '' ? s.time : '?';
                                                            return `${displayKg}⏱️${displayTime}`;
                                                        }
                                                        const displayKg = s.kg !== null && s.kg !== undefined && s.kg !== '' ? s.kg : '?';
                                                        const displayReps = s.reps !== null && s.reps !== undefined && s.reps !== '' ? s.reps : '?';
                                                        return `${displayKg}kg×${displayReps}`;
                                                        }).join(', ')}</span>
                                                    )}
                                                </div>
                                            );
                                        })}
                                    </div>
                                )}

                                {hasRatings && (
                                    <div style={{ display: 'flex', gap: '10px', marginTop: '10px', paddingTop: '10px', borderTop: '1px dashed var(--glass-border)' }} className="text-sm">
                                        {moodVal && <span className="badge badge-primary">Umore: {moodVal}/10</span>}
                                        {pumpVal && <span className="badge badge-primary">Pump: {pumpVal}/10</span>}
                                        {fatigueVal && <span className="badge badge-primary">Stanchezza: {fatigueVal}/10</span>}
                                    </div>
                                )}
                            </div>
                        )}} />
                </div>
            )}
        </div>
    );
};

export default TrainingHistory;
