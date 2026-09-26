import React, { useId } from 'react';
import { ArrowUp, ArrowDown, Trash2, Activity, CircleHelp } from 'lucide-react';
import { ExerciseLibraryItem, PlannedSetTechnique, ProgressionContract, SetTechnique } from '../../../types';
import { techniqueLabel } from '../../../lib/advancedSets';
import { useDialogStore } from '../../../store/useDialogStore';

const TECHNIQUE_HELP = {
    setTechnique: {
        title: 'Tecnica per serie',
        message: 'Definisce come è strutturata ciascuna serie della scheda: normale, dropset, rest-pause, cluster, rep-match o diminishing. Tecniche diverse rendono le prestazioni meno direttamente confrontabili. La scelta non assegna automaticamente un punteggio di stimolo o fatica.',
    },
    technicalStandard: {
        title: 'Esecuzione da mantenere',
        message: 'Descrive le condizioni che vuoi mantenere stabili per confrontare le prestazioni nel tempo: ROM, setup, macchina, pause, tempo o altri dettagli esecutivi. Se lo standard cambia, LogBook evita di trattare la nuova prestazione come direttamente equivalente alla precedente.',
    },
    role: {
        title: 'Ruolo nella scheda',
        message: 'Indica quanto questo esercizio conta nella progressione di questa scheda. Primario = riferimento principale; Secondario = importante ma non centrale; Supporto = lavoro complementare. Non cambia automaticamente serie o carichi.',
    },
    metric: {
        title: 'Cosa vuoi migliorare',
        message: 'Indica quale tipo di progresso vuoi interpretare in questo esercizio: performance, volume, densità o qualità dell’esecuzione. Serve al Progression Engine per leggere correttamente i dati; non modifica da solo il programma.',
    },
} as const;

type TechniqueHelpKey = keyof typeof TECHNIQUE_HELP;

interface RoutineExerciseItemProps {
    exercise: any;
    index: number;
    totalExercises: number;
    libDef?: ExerciseLibraryItem;
    onMove: (index: number, direction: number) => void;
    onRemove: (index: number) => void;
    onUpdateSetsCount: (index: number, value: string) => void;
    onUpdateReps: (index: number, field: 'minReps' | 'maxReps', value: string) => void;
    onUpdateSetPlan: (exerciseIndex: number, setIndex: number, tech: SetTechnique) => void;
    onUpdateSetPlanField: (exerciseIndex: number, setIndex: number, field: 'restSeconds' | 'segmentCount' | 'targetReps', value: string) => void;
    onUpdateExerciseMetadata: (exerciseIndex: number, field: 'technicalStandard' | keyof ProgressionContract, value: string) => void;
}

export const RoutineExerciseItem: React.FC<RoutineExerciseItemProps> = ({
    exercise,
    index,
    totalExercises,
    libDef,
    onMove,
    onRemove,
    onUpdateSetsCount,
    onUpdateReps,
    onUpdateSetPlan,
    onUpdateSetPlanField,
    onUpdateExerciseMetadata
}) => {
    const isCardio = libDef?.trackingType === 'cardio';
    const fieldId = useId();
    const setsId = `${fieldId}-sets`;
    const minRepsId = `${fieldId}-min-reps`;
    const maxRepsId = `${fieldId}-max-reps`;
    const showAlert = useDialogStore(state => state.showAlert);
    const showTechniqueHelp = (key: TechniqueHelpKey) => {
        const help = TECHNIQUE_HELP[key];
        void showAlert(help.message, help.title);
    };
    const helpButton = (key: TechniqueHelpKey) => (
        <button
            type="button"
            className="btn-icon"
            onClick={() => showTechniqueHelp(key)}
            aria-label={`Spiega: ${TECHNIQUE_HELP[key].title}`}
            title={`Spiega ${TECHNIQUE_HELP[key].title}`}
            style={{ flexShrink: 0 }}
        >
            <CircleHelp size={18} aria-hidden="true" />
        </button>
    );
    const fieldHeader = (label: string, key: TechniqueHelpKey, htmlFor: string) => (
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '8px' }}>
            <label htmlFor={htmlFor}>{label}</label>
            {helpButton(key)}
        </div>
    );

    return (
        <div className="flex-col bg-card-inner p-12 rounded-8 gap-10" style={{ border: '1px solid var(--glass-border)' }}>
            <div className="flex-between gap-10 items-center">
                <div className="text-md font-semibold flex-1">
                    {index + 1}. {libDef ? libDef.name : 'Esercizio rimosso'}
                </div>
                <div className="flex gap-4">
                    <button
                        type="button"
                        className="btn-icon"
                        disabled={index === 0}
                        style={{ opacity: index === 0 ? 0.3 : 1 }}
                        onClick={() => onMove(index, -1)}
                        aria-label="Sposta in alto"
                    >
                        <ArrowUp size={18} aria-hidden="true" />
                    </button>
                    <button
                        type="button"
                        className="btn-icon"
                        disabled={index === totalExercises - 1}
                        style={{ opacity: index === totalExercises - 1 ? 0.3 : 1 }}
                        onClick={() => onMove(index, 1)}
                        aria-label="Sposta in basso"
                    >
                        <ArrowDown size={18} aria-hidden="true" />
                    </button>
                    <button
                        type="button"
                        className="btn-icon text-danger"
                        onClick={() => onRemove(index)}
                        aria-label="Rimuovi esercizio"
                    >
                        <Trash2 size={18} aria-hidden="true" />
                    </button>
                </div>
            </div>

            {isCardio ? (
                /* Esercizio cardio: nessun campo Serie/Reps/Tecnica */
                <div style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: '8px',
                    padding: '10px 12px',
                    borderRadius: '8px',
                    background: 'var(--primary-soft)',
                    border: '1px solid var(--primary-color)',
                    marginTop: '4px'
                }}>
                    <Activity size={18} aria-hidden="true" style={{ color: 'var(--primary-color)' }} />
                    <span style={{ fontSize: '0.85rem', color: 'var(--text-muted)' }}>
                        Esercizio cardio — le metriche verranno registrate durante la sessione.
                    </span>
                </div>
            ) : (
                <>
                    {/* Riga 1: Serie */}
                    <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                        <label htmlFor={setsId} style={{ fontSize: '0.85rem', color: 'var(--text-muted)', fontWeight: 600, width: '75px', flexShrink: 0 }}>
                            Serie:
                        </label>
                        <input
                            id={setsId}
                            type="number" min="1" max="20"
                            placeholder="3"
                            value={exercise.setsCount !== undefined && exercise.setsCount !== null ? exercise.setsCount : ''}
                            onChange={e => onUpdateSetsCount(index, e.target.value)}
                            onFocus={e => e.target.select()}
                            style={{
                                width: '90px',
                                height: '42px',
                                minHeight: '42px',
                                margin: 0,
                                padding: '8px 12px',
                                fontSize: '16px',
                                textAlign: 'center',
                                borderRadius: '8px',
                                background: 'var(--surface-light)',
                                border: '1px solid var(--glass-border)',
                                color: 'var(--text-main)',
                                boxSizing: 'border-box'
                            }}
                            onClick={e => e.stopPropagation()}
                        />
                    </div>

                    {/* Riga 2: Rep min e Rep max */}
                    {libDef?.trackingType !== 'time' ? (
                        <div style={{ display: 'flex', alignItems: 'center', gap: '10px', width: '100%' }}>
                            <span id={`${fieldId}-reps-label`} style={{ fontSize: '0.85rem', color: 'var(--text-muted)', fontWeight: 600, width: '75px', flexShrink: 0 }}>
                                Ripetizioni:
                            </span>
                            <div style={{ display: 'flex', alignItems: 'center', gap: '8px', flex: 1, minWidth: 0 }}>
                                <input
                                    id={minRepsId}
                                    type="number"
                                    aria-label="Ripetizioni minime"
                                    aria-describedby={`${fieldId}-reps-label`}
                                    placeholder="Min (es. 8)"
                                    value={exercise.minReps || ''}
                                    onChange={e => onUpdateReps(index, 'minReps', e.target.value)}
                                    onFocus={e => e.target.select()}
                                    style={{
                                        flex: 1,
                                        minWidth: 0,
                                        height: '42px',
                                        minHeight: '42px',
                                        margin: 0,
                                        padding: '8px 8px',
                                        fontSize: '16px',
                                        textAlign: 'center',
                                        borderRadius: '8px',
                                        background: 'var(--surface-light)',
                                        border: '1px solid var(--glass-border)',
                                        color: 'var(--text-main)',
                                        boxSizing: 'border-box'
                                    }}
                                />
                                <span style={{ color: 'var(--text-muted)', fontWeight: 'bold', fontSize: '1rem' }}>-</span>
                                <input
                                    id={maxRepsId}
                                    type="number"
                                    aria-label="Ripetizioni massime"
                                    aria-describedby={`${fieldId}-reps-label`}
                                    placeholder="Max (es. 12)"
                                    value={exercise.maxReps || ''}
                                    onChange={e => onUpdateReps(index, 'maxReps', e.target.value)}
                                    onFocus={e => e.target.select()}
                                    style={{
                                        flex: 1,
                                        minWidth: 0,
                                        height: '42px',
                                        minHeight: '42px',
                                        margin: 0,
                                        padding: '8px 8px',
                                        fontSize: '16px',
                                        textAlign: 'center',
                                        borderRadius: '8px',
                                        background: 'var(--surface-light)',
                                        border: '1px solid var(--glass-border)',
                                        color: 'var(--text-main)',
                                        boxSizing: 'border-box'
                                    }}
                                />
                            </div>
                        </div>
                    ) : (
                        <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                            <label style={{ fontSize: '0.85rem', color: 'var(--text-muted)', fontWeight: 600, width: '75px', flexShrink: 0 }}>
                                Tipo:
                            </label>
                            <span className="text-muted text-xs italic">Tracciamento a tempo</span>
                        </div>
                    )}



                </>
            )}

            <details style={{ borderTop: '1px solid var(--glass-border)', paddingTop: '8px' }}>
                <summary className="disclosure-summary technique-summary">
                    Tecnica
                </summary>
                <div style={{ display: 'grid', gap: '10px', paddingTop: '8px' }}>
                    <p className="text-xs text-muted" style={{ margin: 0 }}>
                        Queste impostazioni valgono solo per questo utilizzo dell’esercizio in questa scheda. Lo stesso esercizio può avere impostazioni diverse in un’altra scheda.
                    </p>

                    {!isCardio && (
                        <div style={{ paddingTop: '6px', borderTop: '1px solid var(--glass-border)' }}>
                            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '8px', marginBottom: '8px' }}>
                                <span style={{ fontSize: '0.85rem', color: 'var(--text-muted)', fontWeight: 600 }}>
                                    Tecnica per serie:
                                </span>
                                {helpButton('setTechnique')}
                            </div>
                            {Array.from({ length: Math.max(1, Number.parseInt(String(exercise.setsCount || 3), 10) || 3) }, (_, setIndex) => {
                                const plan: PlannedSetTechnique | undefined = exercise.setPlans?.[setIndex];
                                const technique: SetTechnique = plan?.technique || 'straight';
                                return (
                                    <div key={setIndex} style={{ display: 'grid', gridTemplateColumns: '44px minmax(0, 1fr)', gap: '8px', alignItems: 'center', marginBottom: '8px' }}>
                                        <strong style={{ fontSize: '0.8rem' }}>S{setIndex + 1}</strong>
                                        <div style={{ minWidth: 0 }}>
                                            <select
                                                aria-label={`Tecnica serie ${setIndex + 1}`}
                                                value={technique}
                                                onChange={event => onUpdateSetPlan(index, setIndex, event.target.value as SetTechnique)}
                                                style={{ margin: 0, width: '100%', minHeight: '44px', fontSize: '16px' }}
                                            >
                                                <option value="straight">Serie normale</option>
                                                <option value="dropset">Dropset</option>
                                                <option value="rest_pause">Rest-pause</option>
                                                <option value="cluster">Cluster</option>
                                                <option value="rep_match">Rep-match</option>
                                                <option value="diminishing">Diminishing set</option>
                                            </select>
                                            {technique !== 'straight' && (
                                                <div style={{ display: 'flex', gap: '6px', flexWrap: 'wrap', marginTop: '6px' }}>
                                                    {technique !== 'dropset' && (
                                                        <input
                                                            type="number"
                                                            min="0"
                                                            aria-label={`Recupero serie ${setIndex + 1}`}
                                                            placeholder="Rec s"
                                                            value={plan?.restSeconds ?? ''}
                                                            onChange={event => onUpdateSetPlanField(index, setIndex, 'restSeconds', event.target.value)}
                                                            style={{ margin: 0, width: '88px', minHeight: '44px', fontSize: '16px' }}
                                                        />
                                                    )}
                                                    {technique === 'cluster' && (
                                                        <input
                                                            type="number"
                                                            min="2"
                                                            aria-label={`Segmenti serie ${setIndex + 1}`}
                                                            placeholder="Segmenti"
                                                            value={plan?.segmentCount ?? ''}
                                                            onChange={event => onUpdateSetPlanField(index, setIndex, 'segmentCount', event.target.value)}
                                                            style={{ margin: 0, width: '105px', minHeight: '44px', fontSize: '16px' }}
                                                        />
                                                    )}
                                                    {(technique === 'rep_match' || technique === 'diminishing') && (
                                                        <input
                                                            type="number"
                                                            min="1"
                                                            aria-label={`Target ripetizioni serie ${setIndex + 1}`}
                                                            placeholder="Target reps"
                                                            value={plan?.target?.reps ?? ''}
                                                            onChange={event => onUpdateSetPlanField(index, setIndex, 'targetReps', event.target.value)}
                                                            style={{ margin: 0, width: '112px', minHeight: '44px', fontSize: '16px' }}
                                                        />
                                                    )}
                                                    <span style={{ alignSelf: 'center', fontSize: '0.75rem', color: 'var(--text-muted)' }}>
                                                        {techniqueLabel(technique)}
                                                    </span>
                                                </div>
                                            )}
                                        </div>
                                    </div>
                                );
                            })}
                        </div>
                    )}

                    <div className="text-sm">
                        {fieldHeader('Esecuzione da mantenere', 'technicalStandard', `${fieldId}-technical-standard`)}
                        <input
                            id={`${fieldId}-technical-standard`}
                            type="text"
                            value={exercise.technicalStandard ?? ''}
                            placeholder="Es. ROM completo, fermo 1 s al petto, stesso macchinario"
                            onChange={event => onUpdateExerciseMetadata(index, 'technicalStandard', event.target.value)}
                            style={{ width: '100%', minHeight: '44px', fontSize: '16px', marginTop: '4px' }}
                        />
                    </div>

                    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(140px, 1fr))', gap: '8px' }}>
                        <div className="text-sm">
                            {fieldHeader('Ruolo nella scheda', 'role', `${fieldId}-progression-role`)}
                            <select
                                id={`${fieldId}-progression-role`}
                                value={exercise.progressionContract?.role ?? ''}
                                onChange={event => onUpdateExerciseMetadata(index, 'role', event.target.value)}
                                style={{ width: '100%', minHeight: '44px', fontSize: '16px', marginTop: '4px' }}
                            >
                                <option value="">Non specificato</option>
                                <option value="primary">Primario</option>
                                <option value="secondary">Secondario</option>
                                <option value="support">Supporto</option>
                            </select>
                        </div>
                        <div className="text-sm">
                            {fieldHeader('Cosa vuoi migliorare', 'metric', `${fieldId}-progression-metric`)}
                            <select
                                id={`${fieldId}-progression-metric`}
                                value={exercise.progressionContract?.metric ?? ''}
                                onChange={event => onUpdateExerciseMetadata(index, 'metric', event.target.value)}
                                style={{ width: '100%', minHeight: '44px', fontSize: '16px', marginTop: '4px' }}
                            >
                                <option value="">Non specificato</option>
                                <option value="performance">Performance</option>
                                <option value="volume">Volume</option>
                                <option value="density">Densità</option>
                                <option value="execution">Esecuzione</option>
                            </select>
                        </div>
                    </div>



                    <p className="text-xs text-muted" style={{ margin: 0 }}>
                        Il Progression Engine usa esecuzione, ruolo, metrica e tecnica per interpretare i confronti, senza modificare automaticamente carichi, volume o recuperi.
                    </p>
                </div>
            </details>
        </div>
    );
};
