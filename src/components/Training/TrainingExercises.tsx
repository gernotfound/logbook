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
            <div className="card" style={editingExId ? { border: '2px solid var(--primary-color)' } : undefined}>
                <h3 style={{ color: editingExId ? 'var(--primary-color)' : 'white' }}>
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
                
                <div style={{ margin: '15px 0' }}>
                    <label style={{ fontSize: '0.8rem', color: 'var(--text-muted)', display: 'block', marginBottom: '8px' }}>Tipo di tracciamento</label>
                    <div style={{ display: 'flex', gap: '10px' }}>
                        <label style={{ display: 'flex', alignItems: 'center', gap: '5px', cursor: 'pointer' }}>
                            <input 
                                type="radio" 
                                name="trackingType" 
                                value="weight_reps" 
                                checked={trackingType === 'weight_reps'} 
                                onChange={() => setTrackingType('weight_reps')} 
                            />
                            Peso e Ripetizioni
                        </label>
                        <label style={{ display: 'flex', alignItems: 'center', gap: '5px', cursor: 'pointer' }}>
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
                
                <div style={{ margin: '15px 0' }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '10px' }}>
                        <label style={{ fontSize: '0.8rem', color: 'var(--text-muted)' }}>Muscoli Focus</label>
                        <div style={{ display: 'flex', gap: '5px', background: 'rgba(0,0,0,0.2)', padding: '4px', borderRadius: '8px' }}>
                            <button 
                                className={`btn-icon ${selectionMode === 'primary' ? 'active' : ''}`} 
                                style={{ padding: '4px 12px', fontSize: '0.75rem', borderRadius: '6px', background: selectionMode === 'primary' ? 'var(--primary-color)' : 'transparent', color: selectionMode === 'primary' ? '#000' : 'var(--text-muted)' }}
                                onClick={() => setSelectionMode('primary')}
                            >
                                Primari
                            </button>
                            <button 
                                className={`btn-icon ${selectionMode === 'secondary' ? 'active' : ''}`} 
                                style={{ padding: '4px 12px', fontSize: '0.75rem', borderRadius: '6px', background: selectionMode === 'secondary' ? 'var(--secondary-color, #4db6ac)' : 'transparent', color: selectionMode === 'secondary' ? '#000' : 'var(--text-muted)' }}
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
                        <div style={{ maxHeight: '150px', overflowY: 'auto', background: 'var(--surface-color)', border: '1px solid var(--glass-border)', borderRadius: '8px', marginBottom: '10px' }}>
                            {filteredMuscles.map(m => (
                                <div 
                                    key={m.id} 
                                    style={{ padding: '8px 12px', cursor: 'pointer', borderBottom: '1px solid var(--glass-border)' }}
                                    onClick={() => toggleMuscle(m)}
                                >
                                    {m.name}
                                </div>
                            ))}
                        </div>
                    )}

                    <div style={{ display: 'flex', flexWrap: 'wrap', gap: '5px', marginBottom: '15px' }}>
                        {selectedMuscles.map(m => (
                            <span key={m.id} className="badge badge-primary" style={{ display: 'flex', alignItems: 'center', gap: '5px' }}>
                                {m.name}
                                <span style={{ cursor: 'pointer', fontWeight: 'bold' }} onClick={() => toggleMuscle(m)}>✕</span>
                            </span>
                        ))}
                        {secondaryMuscles.map(m => (
                            <span key={m.id} className="badge" style={{ background: 'var(--secondary-color, rgba(0, 229, 255, 0.3))', color: '#fff', border: '1px solid var(--secondary-color, #4db6ac)', display: 'flex', alignItems: 'center', gap: '5px' }}>
                                {m.name}
                                <span style={{ cursor: 'pointer', fontWeight: 'bold' }} onClick={() => toggleMuscle(m)}>✕</span>
                            </span>
                        ))}
                    </div>

                    {/* Modello Muscolare 3D-like (SVG) interattivo */}
                    <div style={{ textAlign: 'center', fontSize: '0.8rem', color: 'var(--text-muted)', marginBottom: '5px' }}>
                        💡 Puoi anche toccare i muscoli sul manichino
                    </div>
                    <MuscleModel 
                        selectedMuscles={selectedMuscleIds as any} 
                        secondaryMuscles={secondaryMuscles.map((m: any) => m.id)}
                        interactive={true}
                        onToggleMuscle={handleToggleMuscleById}
                    />
                </div>

                <div style={{ display: 'flex', gap: '10px', marginTop: '20px' }}>
                    {editingExId && (
                        <button className="btn" style={{ flex: 1, background: 'rgba(255,255,255,0.1)' }} onClick={handleCancelEdit}>
                            Annulla
                        </button>
                    )}
                    <button className="btn btn-primary" style={{ flex: 2 }} onClick={handleSaveExercise}>
                        {editingExId ? '💾 Salva Modifiche' : '+ Aggiungi in Archivio'}
                    </button>
                </div>
            </div>

            <h3 style={{ marginTop: '20px' }}>Lista Esercizi ({library.length})</h3>
            <p style={{ fontSize: '0.8rem', color: 'var(--text-muted)' }}>Clicca su un esercizio per vederne i dettagli o sull'icona per modificarlo.</p>
            {library.length === 0 ? (
                <p style={{ color: 'var(--text-muted)' }}>Nessun esercizio creato.</p>
            ) : (
                <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
                    {library.map(ex => (
                        <div 
                            key={ex.id} 
                            className="card" 
                            style={{ padding: '15px', marginBottom: 0 }}
                        >
                            <div 
                                style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', cursor: 'pointer', borderLeft: editingExId === ex.id ? '3px solid var(--primary-color)' : 'none', paddingLeft: editingExId === ex.id ? '10px' : '0' }}
                                onClick={() => setExpandedExId(expandedExId === ex.id ? null : ex.id)}
                            >
                                <div>
                                    <div style={{ fontWeight: 'bold', color: (expandedExId === ex.id || editingExId === ex.id) ? 'var(--primary-color)' : 'white' }}>{ex.name}</div>
                                    {ex.notes && <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>{ex.notes}</div>}
                                </div>
                                <div style={{ display: 'flex', gap: '10px', alignItems: 'center' }}>
                                    <button className="btn-icon" style={{ color: 'var(--primary-color)' }} onClick={(e) => { e.stopPropagation(); handleEditClick(ex); setExpandedExId(ex.id); }}>✏️</button>
                                    <button className="btn-icon" style={{ color: 'var(--danger-color)' }} onClick={(e) => handleDelete(ex.id, e)}>🗑️</button>
                                </div>
                            </div>
                            {expandedExId === ex.id && (
                                <div style={{ marginTop: '15px', paddingTop: '15px', borderTop: '1px solid var(--glass-border)' }}>
                                    <div style={{ marginBottom: '10px', fontSize: '0.85rem' }}>
                                        <span style={{ color: 'var(--text-muted)' }}>Tracciamento: </span>
                                        <strong>{ex.trackingType === 'time' ? 'Tempo' : 'Peso e Ripetizioni'}</strong>
                                    </div>
                                    {(ex.muscles || []).length > 0 || (ex.secondaryMuscles || []).length > 0 ? (
                                        <div style={{ display: 'flex', justifyContent: 'center', width: '100%' }}>
                                            <MuscleModel 
                                                selectedMuscles={ex.muscles as any} 
                                                secondaryMuscles={ex.secondaryMuscles as any} 
                                            />
                                        </div>
                                    ) : (
                                        <p style={{ color: 'var(--text-muted)', fontSize: '0.9rem', marginBottom: 0 }}>Nessun muscolo specificato.</p>
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
