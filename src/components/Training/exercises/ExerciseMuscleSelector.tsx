import type { useTrainingExercises } from '../../../hooks/useTrainingExercises';
import MuscleModel from '../MuscleModel';

type TrainingExercisesHook = ReturnType<typeof useTrainingExercises>;

interface ExerciseMuscleSelectorProps {
    muscleSearch: TrainingExercisesHook['muscleSearch'];
    setMuscleSearch: TrainingExercisesHook['setMuscleSearch'];
    selectedMuscles: TrainingExercisesHook['selectedMuscles'];
    secondaryMuscles: TrainingExercisesHook['secondaryMuscles'];
    selectionMode: TrainingExercisesHook['selectionMode'];
    setSelectionMode: TrainingExercisesHook['setSelectionMode'];
    filteredMuscles: TrainingExercisesHook['filteredMuscles'];
    toggleMuscle: TrainingExercisesHook['toggleMuscle'];
    handleToggleMuscleById: TrainingExercisesHook['handleToggleMuscleById'];
}

export function ExerciseMuscleSelector({
    muscleSearch,
    setMuscleSearch,
    selectedMuscles,
    secondaryMuscles,
    selectionMode,
    setSelectionMode,
    filteredMuscles,
    toggleMuscle,
    handleToggleMuscleById,
}: ExerciseMuscleSelectorProps) {
    const selectedMuscleIds = selectedMuscles.map(muscle => muscle.id);

    return (
        <div className="bg-black-10 border-glass rounded-12 p-15 mb-20" style={{ marginTop: '30px' }}>
            <div className="flex-between mb-10">
                <label className="text-white text-sm font-bold">Muscoli coinvolti</label>
                <div className="flex gap-5 bg-black-20 p-4 rounded-8">
                    <button
                        className={`btn-icon ${selectionMode === 'primary' ? 'active' : ''}`}
                        style={{ padding: '4px 12px', fontSize: '0.75rem', borderRadius: '6px', background: selectionMode === 'primary' ? 'var(--primary-color)' : 'transparent', color: selectionMode === 'primary' ? '#000' : 'rgba(255, 255, 255, 0.7)' }}
                        onClick={() => setSelectionMode('primary')}
                    >
                        Primari
                    </button>
                    <button
                        className={`btn-icon ${selectionMode === 'secondary' ? 'active' : ''}`}
                        style={{ padding: '4px 12px', fontSize: '0.75rem', borderRadius: '6px', background: selectionMode === 'secondary' ? 'var(--secondary-color, #4db6ac)' : 'transparent', color: selectionMode === 'secondary' ? '#000' : 'rgba(255, 255, 255, 0.7)' }}
                        onClick={() => setSelectionMode('secondary')}
                    >
                        Secondari
                    </button>
                </div>
            </div>

            <div style={{ position: 'relative', display: 'flex', alignItems: 'center' }} className="mb-10">
                <input
                    type="text"
                    placeholder="🔍 Cerca muscolo (es. Petto, Bicipiti)..."
                    value={muscleSearch}
                    onChange={event => setMuscleSearch(event.target.value)}
                    style={{
                        width: '100%',
                        margin: 0,
                        paddingRight: muscleSearch ? '36px' : '14px',
                        fontSize: '16px'
                    }}
                />
                {muscleSearch && (
                    <button
                        type="button"
                        onClick={() => setMuscleSearch('')}
                        style={{
                            position: 'absolute',
                            right: '8px',
                            background: 'transparent',
                            border: 'none',
                            color: 'var(--text-muted)',
                            fontSize: '1rem',
                            cursor: 'pointer',
                            padding: '6px',
                            display: 'flex',
                            alignItems: 'center',
                            justifyContent: 'center'
                        }}
                        aria-label="Cancella ricerca"
                    >
                        ✕
                    </button>
                )}
            </div>

            {muscleSearch && (
                <div
                    className="flex-col gap-6 mb-12 overflow-y-auto p-6 rounded-8"
                    style={{
                        background: 'rgba(0, 0, 0, 0.35)',
                        border: '1px solid var(--glass-border)',
                        maxHeight: '220px'
                    }}
                >
                    {filteredMuscles.length === 0 ? (
                        <div className="text-muted text-xs p-8 text-center">Nessun muscolo trovato</div>
                    ) : (
                        filteredMuscles.map(muscle => {
                            const isPrimary = selectedMuscleIds.includes(muscle.id);
                            const isSecondary = secondaryMuscles.some(secondary => secondary.id === muscle.id);

                            let btnBackground = 'var(--surface-light, #1a1a1a)';
                            let btnColor = '#ffffff';
                            let btnBorder = '1px solid rgba(255, 255, 255, 0.08)';
                            let badgeColor = 'rgba(255, 255, 255, 0.7)';

                            if (isPrimary) {
                                btnBackground = 'linear-gradient(135deg, var(--primary-color), var(--primary-dark))';
                                btnColor = '#000000';
                                btnBorder = '1px solid var(--primary-color)';
                                badgeColor = '#000000';
                            } else if (isSecondary) {
                                btnBackground = 'rgba(0, 229, 255, 0.15)';
                                btnColor = '#ffffff';
                                btnBorder = '1px solid var(--secondary-color, #4db6ac)';
                                badgeColor = 'var(--secondary-color, #4db6ac)';
                            }

                            return (
                                <button
                                    key={muscle.id}
                                    type="button"
                                    className="flex-between items-center w-full rounded-8 text-sm transition"
                                    style={{
                                        background: btnBackground,
                                        color: btnColor,
                                        border: btnBorder,
                                        padding: '10px 12px',
                                        cursor: 'pointer',
                                        textAlign: 'left',
                                        boxSizing: 'border-box'
                                    }}
                                    onClick={() => toggleMuscle(muscle)}
                                >
                                    <span style={{ fontWeight: 600, color: btnColor }}>{muscle.name}</span>
                                    <span style={{ fontSize: '0.75rem', fontWeight: 600, color: badgeColor }}>
                                        {isPrimary ? '✓ Primario' : isSecondary ? '✓ Secondario' : '+ Aggiungi'}
                                    </span>
                                </button>
                            );
                        })
                    )}
                </div>
            )}

            <div className="flex flex-wrap gap-5 mt-10 mb-15">
                {selectedMuscles.map(muscle => (
                    <span key={muscle.id} className="badge badge-primary flex items-center gap-5">
                        {muscle.name}
                        <span className="cursor-pointer font-bold" onClick={() => toggleMuscle(muscle)}>✕</span>
                    </span>
                ))}
                {secondaryMuscles.map(muscle => (
                    <span key={muscle.id} className="badge flex items-center gap-5" style={{ background: 'var(--secondary-color, rgba(0, 229, 255, 0.3))', color: '#fff', border: '1px solid var(--secondary-color, #4db6ac)' }}>
                        {muscle.name}
                        <span className="cursor-pointer font-bold" onClick={() => toggleMuscle(muscle)}>✕</span>
                    </span>
                ))}
            </div>

            <div className="rounded-8 overflow-hidden" style={{ background: 'rgba(0,0,0,0.1)' }}>
                <MuscleModel
                    selectedMuscles={selectedMuscleIds as any}
                    secondaryMuscles={secondaryMuscles.map((muscle: any) => muscle.id)}
                    interactive={true}
                    onToggleMuscle={handleToggleMuscleById}
                />
            </div>
        </div>
    );
}
