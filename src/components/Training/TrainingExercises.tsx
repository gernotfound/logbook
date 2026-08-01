import { useState, useMemo } from 'react';
import MuscleModel from './MuscleModel';
import { useTrainingExercises } from '../../hooks/useTrainingExercises';

const TrainingExercises = () => {
    const [expandedExId, setExpandedExId] = useState<string | null>(null);
    const {
        editingExId, exName, setExName, exNotes, setExNotes,
        muscleSearch, setMuscleSearch, selectedMuscles, secondaryMuscles,
        selectionMode, setSelectionMode,
        library, filteredMuscles, trackingType, setTrackingType,
        toggleMuscle, handleToggleMuscleById, handleEditClick, handleCancelEdit,
        handleSaveExercise, handleDelete
    } = useTrainingExercises();

    const selectedMuscleIds = useMemo(() => selectedMuscles.map(m => m.id), [selectedMuscles]);

    return (
        <div className="training-sub-view active">
            <div className={`card ${editingExId ? 'border-primary' : ''}`}>
                <h3 className={editingExId ? 'text-primary' : 'text-white'}>
                    {editingExId ? 'Modifica Esercizio' : 'Nuovo Esercizio'}
                </h3>
                <input 
                    type="text" 
                    placeholder="Nome Esercizio (es. Panca Piana)" 
                    value={exName}
                    onChange={e => setExName(e.target.value)}
                />
                <input 
                    type="text" 
                    placeholder="Note Setup (es. Inclinazione panca)" 
                    value={exNotes}
                    onChange={e => setExNotes(e.target.value)}
                />
                
                <div className="my-15">
                    <label className="text-muted text-sm mb-8 block">Tipo di tracciamento</label>
                    <div className="flex gap-10">
                        <label className="flex items-center gap-5 cursor-pointer">
                            <input 
                                type="radio" 
                                name="trackingType" 
                                value="weight_reps" 
                                checked={trackingType === 'weight_reps'} 
                                onChange={() => setTrackingType('weight_reps')} 
                            />
                            Peso e Ripetizioni
                        </label>
                        <label className="flex items-center gap-5 cursor-pointer">
                            <input 
                                type="radio" 
                                name="trackingType" 
                                value="time" 
                                checked={trackingType === 'time'} 
                                onChange={() => setTrackingType('time')} 
                            />
                            Tempo
                        </label>
                    </div>
                </div>
                
                <div className="my-15">
                    <div className="flex-between mb-10">
                        <label className="text-muted text-sm">Muscoli Focus</label>
                        <div className="flex gap-5 bg-black-20 p-4 rounded-8">
                            <button 
                                className={`btn-icon ${selectionMode === 'primary' ? 'active text-black' : 'text-muted'}`} 
                                style={{ padding: '4px 12px', fontSize: '0.75rem', borderRadius: '6px', background: selectionMode === 'primary' ? 'var(--primary-color)' : 'transparent' }}
                                onClick={() => setSelectionMode('primary')}
                            >
                                Primari
                            </button>
                            <button 
                                className={`btn-icon ${selectionMode === 'secondary' ? 'active text-black' : 'text-muted'}`} 
                                style={{ padding: '4px 12px', fontSize: '0.75rem', borderRadius: '6px', background: selectionMode === 'secondary' ? 'var(--secondary-color, #4db6ac)' : 'transparent' }}
                                onClick={() => setSelectionMode('secondary')}
                            >
                                Secondari
                            </button>
                        </div>
                    </div>

                    <input 
                        type="text" 
                        placeholder={selectionMode === 'primary' ? "Cerca muscolo primario..." : "Cerca muscolo secondario..."} 
                        value={muscleSearch}
                        onChange={e => setMuscleSearch(e.target.value)}
                        style={{ borderColor: selectionMode === 'primary' ? 'var(--primary-color)' : 'var(--secondary-color, #4db6ac)' }}
                    />
                    
                    {muscleSearch && (
                        <div className="bg-surface border-glass rounded-8 mb-10 overflow-y-auto" style={{ maxHeight: '150px' }}>
                            {filteredMuscles.map(m => (
                                <div 
                                    key={m.id} 
                                    className="p-8-12 cursor-pointer border-b"
                                    onClick={() => toggleMuscle(m)}
                                >
                                    {m.name}
                                </div>
                            ))}
                        </div>
                    )}

                    <div className="flex flex-wrap gap-5 mb-15">
                        {selectedMuscles.map(m => (
                            <span key={m.id} className="badge badge-primary flex items-center gap-5">
                                {m.name}
                                <span className="cursor-pointer font-bold" onClick={() => toggleMuscle(m)}>✕</span>
                            </span>
                        ))}
                        {secondaryMuscles.map(m => (
                            <span key={m.id} className="badge flex items-center gap-5" style={{ background: 'var(--secondary-color, rgba(0, 229, 255, 0.3))', color: '#fff', border: '1px solid var(--secondary-color, #4db6ac)' }}>
                                {m.name}
                                <span className="cursor-pointer font-bold" onClick={() => toggleMuscle(m)}>✕</span>
                            </span>
                        ))}
                    </div>

                    {/* Modello Muscolare 3D-like (SVG) interattivo */}
                    <MuscleModel 
                        selectedMuscles={selectedMuscleIds as any} 
                        secondaryMuscles={secondaryMuscles.map((m: any) => m.id)}
                        interactive={true}
                        onToggleMuscle={handleToggleMuscleById}
                    />
                </div>

                <div className="flex gap-10 mt-20">
                    {editingExId && (
                        <button className="btn flex-1" style={{ background: 'rgba(255,255,255,0.1)' }} onClick={handleCancelEdit}>
                            Annulla
                        </button>
                    )}
                    <button className="btn btn-primary flex-2" onClick={handleSaveExercise}>
                        {editingExId ? '💾 Salva Modifiche' : '+ Aggiungi in Archivio'}
                    </button>
                </div>
            </div>

            <h3 className="mt-20">Lista Esercizi ({library.length})</h3>
            <p className="text-muted text-sm">Clicca su un esercizio per vederne i dettagli o sull'icona per modificarlo.</p>
            {library.length === 0 ? (
                <p className="text-muted">Nessun esercizio creato.</p>
            ) : (
                <div className="flex-col gap-10">
                    {library.map(ex => (
                        <div 
                            key={ex.id} 
                            className="card p-15 mb-0"
                        >
                            <div 
                                className="flex-between cursor-pointer"
                                style={{ borderLeft: editingExId === ex.id ? '3px solid var(--primary-color)' : 'none', paddingLeft: editingExId === ex.id ? '10px' : '0' }}
                                onClick={() => setExpandedExId(expandedExId === ex.id ? null : ex.id)}
                            >
                                <div>
                                    <div className={`font-bold ${(expandedExId === ex.id || editingExId === ex.id) ? 'text-primary' : 'text-white'}`}>{ex.name}</div>
                                    {ex.notes && <div className="text-muted" style={{ fontSize: '0.75rem' }}>{ex.notes}</div>}
                                </div>
                                <div className="flex items-center gap-10">
                                    <button className="btn-icon text-primary" onClick={(e) => { e.stopPropagation(); handleEditClick(ex); setExpandedExId(ex.id); }}>✏️</button>
                                    <button className="btn-icon text-danger" onClick={(e) => handleDelete(ex.id, e)}>🗑️</button>
                                </div>
                            </div>
                            {expandedExId === ex.id && (
                                <div className="mt-15 pt-15 border-t">
                                    <div className="mb-10 text-sm">
                                        <span className="text-muted">Tracciamento: </span>
                                        <strong>{ex.trackingType === 'time' ? 'Tempo' : 'Peso e Ripetizioni'}</strong>
                                    </div>
                                    {(ex.muscles || []).length > 0 || (ex.secondaryMuscles || []).length > 0 ? (
                                        <div className="flex-center w-full">
                                            <MuscleModel 
                                                selectedMuscles={ex.muscles as any} 
                                                secondaryMuscles={ex.secondaryMuscles as any} 
                                            />
                                        </div>
                                    ) : (
                                        <p className="text-muted text-md mb-0">Nessun muscolo specificato.</p>
                                    )}
                                </div>
                            )}
                        </div>
                    ))}
                </div>
            )}
        </div>
    );
};

export default TrainingExercises;
