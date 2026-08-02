import { useState, useMemo } from 'react';
import { Dumbbell, Timer } from 'lucide-react';
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
                <div className="flex-col gap-10 mt-15 mb-20">
                    <div>
                        <label className="text-muted text-sm block mb-5">Nome dell'Esercizio *</label>
                        <input 
                            type="text" 
                            placeholder="es. Panca Piana con Bilanciere" 
                            value={exName}
                            onChange={e => setExName(e.target.value)}
                        />
                    </div>
                    <div>
                        <label className="text-muted text-sm block mb-5">Note di Setup (opzionale)</label>
                        <input 
                            type="text" 
                            placeholder="es. Inclinazione 30 gradi, presa media" 
                            value={exNotes}
                            onChange={e => setExNotes(e.target.value)}
                        />
                    </div>
                </div>
                
                <div className="mb-20">
                    <label className="text-muted text-sm mb-8 block font-medium">Tipo di tracciamento</label>
                    <div className="tracking-type-group">
                        <button 
                            type="button"
                            className={`tracking-card-option ${trackingType === 'weight_reps' ? 'active' : ''}`}
                            onClick={() => setTrackingType('weight_reps')}
                        >
                            <span className="icon">
                                <Dumbbell size={18} />
                            </span>
                            <span>Peso e Ripetizioni</span>
                        </button>
                        <button 
                            type="button"
                            className={`tracking-card-option ${trackingType === 'time' ? 'active' : ''}`}
                            onClick={() => setTrackingType('time')}
                        >
                            <span className="icon">
                                <Timer size={18} />
                            </span>
                            <span>A Tempo</span>
                        </button>
                    </div>
                </div>
                
                <div className="bg-black-10 border-glass rounded-12 p-15 mb-20">
                    <div className="flex-between mb-10">
                        <label className="text-white text-sm font-bold">Muscoli Coinvolti</label>
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

                    <input 
                        type="text" 
                        placeholder={selectionMode === 'primary' ? "Cerca muscolo primario..." : "Cerca muscolo secondario..."} 
                        value={muscleSearch}
                        onChange={e => setMuscleSearch(e.target.value)}
                        style={{ borderColor: selectionMode === 'primary' ? 'var(--primary-color)' : 'var(--secondary-color, #4db6ac)', backgroundColor: 'rgba(0,0,0,0.2)' }}
                    />
                    
                    {muscleSearch && (
                        <div className="bg-surface border-glass rounded-8 mb-10 mt-5 overflow-y-auto" style={{ maxHeight: '150px' }}>
                            {filteredMuscles.map(m => (
                                <div 
                                    key={m.id} 
                                    className="p-8-12 cursor-pointer border-b hover:bg-black-20 transition-colors"
                                    onClick={() => toggleMuscle(m)}
                                >
                                    {m.name}
                                </div>
                            ))}
                        </div>
                    )}

                    <div className="flex flex-wrap gap-5 mt-10 mb-15">
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

                    <div className="rounded-8 overflow-hidden" style={{ background: 'rgba(0,0,0,0.1)' }}>
                        {/* Modello Muscolare 3D-like (SVG) interattivo */}
                        <MuscleModel 
                            selectedMuscles={selectedMuscleIds as any} 
                            secondaryMuscles={secondaryMuscles.map((m: any) => m.id)}
                            interactive={true}
                            onToggleMuscle={handleToggleMuscleById}
                        />
                    </div>
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
