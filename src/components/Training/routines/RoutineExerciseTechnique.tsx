import { CircleHelp } from 'lucide-react';
import { MAX_ROUTINE_SEGMENTS, previewRoutineSets } from '../../../lib/routineSessionLimits';
import { useDialogStore } from '../../../store/useDialogStore';
import type { PlannedSetTechnique, SetTechnique } from '../../../types';
import type { RoutineExerciseItemProps } from './routineExerciseEditorTypes';

const TECHNIQUE_HELP = {
    technicalStandard: {
        title: 'Esecuzione da mantenere',
        message: 'Descrive le condizioni che vuoi mantenere stabili per confrontare le prestazioni nel tempo: ROM, setup, macchina, pause, tempo o altri dettagli esecutivi. Se lo standard cambia, TheLogBook evita di trattare la nuova prestazione come direttamente equivalente alla precedente.',
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

interface RoutineExerciseTechniqueProps extends Pick<RoutineExerciseItemProps,
    'exercise' | 'index' | 'onUpdateSetPlan' | 'onUpdateSetPlanField' | 'onUpdateExerciseMetadata'> {
    isCardio: boolean;
    fieldId: string;
}

export function RoutineExerciseTechnique({ exercise, index, isCardio, fieldId, onUpdateSetPlan, onUpdateSetPlanField, onUpdateExerciseMetadata }: RoutineExerciseTechniqueProps) {
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
        <details style={{ borderTop: '1px solid var(--glass-border)', paddingTop: '8px' }}>
            <summary className="disclosure-summary technique-summary">
                Tecnica e progressione
            </summary>
            <div style={{ display: 'grid', gap: '10px', paddingTop: '8px' }}>
                {!isCardio && (
                    <div>
                        <div className="routine-technique-set-list">
                            {Array.from({ length: previewRoutineSets(exercise.setsCount, exercise.setPlans ?? []) }, (_, setIndex) => {
                                const plan: PlannedSetTechnique | undefined = exercise.setPlans?.[setIndex];
                                const technique: SetTechnique = plan?.technique || 'straight';
                                const hasParameters = technique !== 'straight' && technique !== 'dropset';
                                return (
                                    <div key={setIndex} className="routine-technique-set">
                                        <div className="routine-technique-set-header">
                                            <strong>Serie {setIndex + 1}</strong>
                                        </div>
                                        <select
                                            className="routine-technique-select"
                                            aria-label={`Tecnica serie ${setIndex + 1}`}
                                            value={technique}
                                            onChange={event => onUpdateSetPlan(index, setIndex, event.target.value as SetTechnique)}
                                        >
                                            <option value="straight">Serie normale</option>
                                            <option value="dropset">Dropset</option>
                                            <option value="rest_pause">Rest-pause</option>
                                            <option value="cluster">Cluster</option>
                                            <option value="rep_match">Rep-match</option>
                                            <option value="diminishing">Diminishing set</option>
                                        </select>
                                        {hasParameters && (
                                            <div className="routine-technique-params">
                                                <label className="routine-technique-param">
                                                    <span>Recupero (s)</span>
                                                    <input
                                                        type="number"
                                                        min="0"
                                                        aria-label={`Recupero serie ${setIndex + 1}`}
                                                        value={plan?.restSeconds ?? ''}
                                                        onChange={event => onUpdateSetPlanField(index, setIndex, 'restSeconds', event.target.value)}
                                                    />
                                                </label>
                                                {technique === 'cluster' && (
                                                    <label className="routine-technique-param">
                                                        <span>Segmenti</span>
                                                        <input
                                                            type="number"
                                                            min="2"
                                                            max={MAX_ROUTINE_SEGMENTS}
                                                            aria-label={`Segmenti serie ${setIndex + 1}`}
                                                            value={plan?.segmentCount ?? ''}
                                                            onChange={event => onUpdateSetPlanField(index, setIndex, 'segmentCount', event.target.value)}
                                                        />
                                                    </label>
                                                )}
                                                {(technique === 'rep_match' || technique === 'diminishing') && (
                                                    <label className="routine-technique-param">
                                                        <span>Target reps</span>
                                                        <input
                                                            type="number"
                                                            min="1"
                                                            aria-label={`Target ripetizioni serie ${setIndex + 1}`}
                                                            value={plan?.target?.reps ?? ''}
                                                            onChange={event => onUpdateSetPlanField(index, setIndex, 'targetReps', event.target.value)}
                                                        />
                                                    </label>
                                                )}
                                            </div>
                                        )}
                                    </div>
                                );
                            })}
                        </div>
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



                <p className="text-base text-muted" style={{ margin: 0 }}>
                    Il Progression Engine usa esecuzione, ruolo, metrica e tecnica per interpretare i confronti, senza modificare automaticamente carichi, volume o recuperi.
                </p>
            </div>
        </details>
    );
}
