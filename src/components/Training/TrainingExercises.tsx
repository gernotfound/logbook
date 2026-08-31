import { useState, useMemo } from 'react';
import { Pencil, Copy, Trash2 } from 'lucide-react';
import { ContextMenu } from '../UI/ContextMenu';

import MuscleModel from './MuscleModel';
import { useTrainingExercises } from '../../hooks/useTrainingExercises';

const TrainingExercises = () => {
    const [expandedExId, setExpandedExId] = useState<string | null>(null);
    const {
        editingExId, exName, setExName, exNotes, setExNotes,
        muscleSearch, setMuscleSearch, selectedMuscles, secondaryMuscles,
        selectionMode, setSelectionMode, isDuplicateName,
        library, routines, filteredMuscles, trackingType, setTrackingType,
        isBodyweight, setIsBodyweight, equipmentWeight, setEquipmentWeight,
        toggleMuscle, handleToggleMuscleById, handleEditClick, handleCancelEdit,
        handleSaveExercise, handleDelete, handleRestoreExercise, handleDuplicate
    } = useTrainingExercises();

    const selectedMuscleIds = useMemo(() => selectedMuscles.map(m => m.id), [selectedMuscles]);
    const editingExercise = useMemo(() => library.find(ex => ex.id === editingExId), [library, editingExId]);

    return (
        <div className="training-sub-view active">
            <div className={editingExId ? 'border-primary' : ''}>
                <h2 className={editingExId ? 'text-primary' : 'text-white'} style={{ fontSize: '1.2rem', marginBottom: '15px' }}>
                    {editingExId ? '✏️ Modifica esercizio' : '➕ Crea nuovo esercizio'}
                </h2>
                <div className="flex-col gap-10 mt-15 mb-20">
                    <div>
                        <input 
                            type="text" 
                            placeholder="Nome esercizio (es. Panca piana con bilanciere)" 
                            value={exName}
                            style={isDuplicateName ? { borderColor: 'var(--danger-color)' } : undefined}
                            onChange={e => setExName(e.target.value)}
                        />
                        {isDuplicateName && (
                            <div style={{ color: 'var(--danger-color)', fontSize: '0.8rem', marginTop: '6px' }}>
                                ⚠️ Esiste già un esercizio con questo nome nell'archivio.
                            </div>
                        )}
                    </div>
                    <input 
                        type="text" 
                        placeholder="Note di setup (opzionale, es. Inclinazione 30°)" 
                        value={exNotes}
                        onChange={e => setExNotes(e.target.value)}
                    />
                </div>
                
                <div className="mb-20">
                    <label className="text-muted text-sm mb-8 block font-medium">Tipo di tracciamento</label>
                    <div className="tracking-type-group" style={{ display: 'flex', gap: '8px', flexWrap: 'nowrap' }}>
                        <button 
                            type="button"
                            className={`tracking-card-option ${trackingType === 'weight_reps' ? 'active' : ''}`}
                            onClick={() => setTrackingType('weight_reps')}
                            style={{ padding: '10px 4px', fontSize: '0.85rem' }}
                        >
                            <span>Peso e rip.</span>
                        </button>
                        <button 
                            type="button"
                            className={`tracking-card-option ${trackingType === 'time' ? 'active' : ''}`}
                            onClick={() => setTrackingType('time')}
                            style={{ padding: '10px 4px', fontSize: '0.85rem' }}
                        >
                            <span>Tempo</span>
                        </button>
                        <button 
                            type="button"
                            className={`tracking-card-option ${trackingType === 'cardio' ? 'active' : ''}`}
                            onClick={() => setTrackingType('cardio' as any)}
                            style={{ padding: '10px 4px', fontSize: '0.85rem' }}
                        >
                            <span>Cardio</span>
                        </button>
                    </div>
                </div>

                {trackingType === 'weight_reps' && (
                    <div className="mb-20" style={{ marginTop: '30px' }}>
                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '14px 0', borderTop: '1px solid rgba(255,255,255,0.08)', borderBottom: '1px solid rgba(255,255,255,0.08)' }}>
                            <label className="text-white text-sm font-medium m-0 cursor-pointer" htmlFor="ex-bodyweight">
                                Esercizio a corpo libero
                            </label>
                            <input 
                                id="ex-bodyweight"
                                type="checkbox"
                                checked={isBodyweight}
                                onChange={e => setIsBodyweight(e.target.checked)}
                                style={{ width: '22px', height: '22px', cursor: 'pointer', accentColor: 'var(--primary-color)', margin: 0 }}
                            />
                        </div>
                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '14px 0', borderBottom: '1px solid rgba(255,255,255,0.08)' }}>
                            <label className="text-white text-sm font-medium m-0" htmlFor="ex-equipment-weight">
                                Peso attrezzo
                            </label>
                            <input 
                                id="ex-equipment-weight"
                                type="number"
                                inputMode="decimal"
                                step="0.5"
                                min="0"
                                placeholder="0"
                                value={equipmentWeight}
                                onChange={e => setEquipmentWeight(e.target.value)}
                                onFocus={e => e.target.select()}
                                style={{ width: '70px', textAlign: 'center', padding: '8px', margin: 0, fontSize: '16px', borderRadius: '8px', background: 'rgba(255,255,255,0.05)', border: '1px solid rgba(255,255,255,0.1)', color: 'var(--text-main)' }}
                            />
                        </div>
                    </div>
                )}
                
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
                            onChange={e => setMuscleSearch(e.target.value)}
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
                                filteredMuscles.map(m => {
                                    const isPrimary = selectedMuscleIds.includes(m.id);
                                    const isSecondary = secondaryMuscles.some(sm => sm.id === m.id);

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
                                            key={m.id} 
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
                                            onClick={() => toggleMuscle(m)}
                                        >
                                            <span style={{ fontWeight: 600, color: btnColor }}>{m.name}</span>
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
                        <MuscleModel 
                            selectedMuscles={selectedMuscleIds as any} 
                            secondaryMuscles={secondaryMuscles.map((m: any) => m.id)}
                            interactive={true}
                            onToggleMuscle={handleToggleMuscleById}
                        />
                    </div>
                </div>

                <div className="flex gap-10 mt-20" style={{ width: '100%', minWidth: 0 }}>
                    {editingExId && (
                        <button 
                            type="button" 
                            className="btn flex-1 mb-0" 
                            style={{ background: 'rgba(255,255,255,0.1)', whiteSpace: 'nowrap', margin: 0 }} 
                            onClick={handleCancelEdit}
                        >
                            Annulla
                        </button>
                    )}
                    <button 
                        type="button" 
                        className={`btn btn-primary ${editingExId ? 'flex-2' : 'w-full'} mb-0`} 
                        style={{ whiteSpace: 'nowrap', margin: 0 }} 
                        onClick={handleSaveExercise}
                    >
                        {editingExId ? <><span aria-hidden="true">💾</span> Salva modifiche</> : '+ Aggiungi in archivio'}
                    </button>
                </div>
                
                {editingExId && editingExercise?.isDefault && (
                    <div className="mt-10">
                        <button
                            type="button"
                            className="btn w-full mb-0"
                            style={{ background: 'rgba(239, 68, 68, 0.1)', color: '#ff4d6d', border: '1px solid rgba(239, 68, 68, 0.3)' }}
                            onClick={() => handleRestoreExercise(editingExId)}
                        >
                            <span aria-hidden="true">🔄</span> Ripristina all'originale
                        </button>
                    </div>
                )}
            </div>

            <h2 className="mt-20" style={{ fontSize: '1.15rem' }}>Archivio esercizi ({library.length})</h2>
            <p className="text-muted text-sm">Clicca su un esercizio per vederne i dettagli o sull'icona per modificarlo.</p>
            {library.length === 0 ? (
                <p className="text-muted">Nessun esercizio creato.</p>
            ) : (
                <div className="flex-col gap-8">
                    {library.map(ex => {
                        const routineCount = routines.filter(r => r.exercises?.some((re: any) => re.exId === ex.id)).length;
                        return (
                        <div 
                            key={ex.id} 
                            className="card p-15 mb-0"
                            style={{ marginBottom: 0 }}
                        >
                            <div 
                                className="flex-between cursor-pointer"
                                style={{ borderLeft: editingExId === ex.id ? '3px solid var(--primary-color)' : 'none', paddingLeft: editingExId === ex.id ? '10px' : '0' }}
                                onClick={() => setExpandedExId(expandedExId === ex.id ? null : ex.id)}
                            >
                                <div style={{ flex: 1, minWidth: 0, paddingRight: '12px' }}>
                                    <div className="flex items-center gap-6" style={{ flexWrap: 'wrap' }}>
                                        <div className={`font-bold ${(expandedExId === ex.id || editingExId === ex.id) ? 'text-primary' : 'text-white'}`}>{ex.name}</div>
                                        {routineCount > 0 && (
                                            <span style={{ fontSize: '0.65rem', padding: '2px 6px', borderRadius: '4px', background: 'rgba(255, 255, 255, 0.05)', color: 'var(--text-muted)', whiteSpace: 'nowrap', flexShrink: 0 }}>
                                                {routineCount === 1 ? 'In 1 scheda' : `In ${routineCount} schede`}
                                            </span>
                                        )}
                                    </div>
                                    {ex.notes && <div className="text-muted" style={{ fontSize: '0.75rem' }}>{ex.notes}</div>}
                                    {(ex.isBodyweight || (ex.equipmentWeight !== undefined && ex.equipmentWeight > 0)) && (
                                        <div className="flex flex-wrap gap-5 mt-4">
                                            {ex.isBodyweight && (
                                                <span className="badge badge-primary" style={{ fontSize: '0.7rem', padding: '2px 6px' }}>
                                                    Corpo libero
                                                </span>
                                            )}
                                            {ex.equipmentWeight !== undefined && ex.equipmentWeight > 0 && (
                                                <span className="badge" style={{ fontSize: '0.7rem', padding: '2px 6px', background: 'rgba(255, 255, 255, 0.1)', color: 'var(--text-muted)', border: '1px solid rgba(255, 255, 255, 0.1)' }}>
                                                    Attrezzo: {ex.equipmentWeight} kg
                                                </span>
                                            )}
                                        </div>
                                    )}
                                </div>
                                <div className="flex items-center gap-10" style={{ flexShrink: 0 }}>
                                    <ContextMenu
                                        items={[
                                            {
                                                label: 'Modifica',
                                                icon: <Pencil size={16} />,
                                                onClick: () => {
                                                    handleEditClick(ex);
                                                    setExpandedExId(ex.id);
                                                }
                                            },
                                            {
                                                label: 'Duplica',
                                                icon: <Copy size={16} />,
                                                onClick: () => handleDuplicate(ex)
                                            },
                                            {
                                                label: 'Elimina',
                                                icon: <Trash2 size={16} />,
                                                variant: 'danger',
                                                hidden: ex.isDefault,
                                                onClick: (e) => handleDelete(ex.id, e)
                                            }
                                        ]}
                                    />
                                </div>
                            </div>
                            {expandedExId === ex.id && (
                                <div className="mt-15 pt-15 border-t">
                                    <div className="mb-10 text-sm">
                                        <span className="text-muted">Tracciamento: </span>
                                        <strong>{ex.trackingType === 'time' ? 'Tempo' : ex.trackingType === 'cardio' ? 'Cardio' : 'Peso e ripetizioni'}</strong>
                                    </div>
                                    {ex.isBodyweight && (
                                        <div className="mb-10 text-sm">
                                            <span className="text-muted">Corpo libero: </span>
                                            <strong className="text-primary">Sì (peso corporeo incluso nel volume)</strong>
                                        </div>
                                    )}
                                    {ex.equipmentWeight !== undefined && ex.equipmentWeight > 0 && (
                                        <div className="mb-10 text-sm">
                                            <span className="text-muted">Peso base attrezzo: </span>
                                            <strong>{ex.equipmentWeight} kg</strong>
                                        </div>
                                    )}
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
                        );
                    })}
                </div>
            )}
        </div>
    );
};

export default TrainingExercises;

