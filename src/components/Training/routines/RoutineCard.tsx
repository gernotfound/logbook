import React from 'react';
import MuscleModel from '../MuscleModel';
import { Routine, RoutineExercise, ExerciseLibraryItem } from '../../../types';
import { ContextMenu, ContextMenuItem } from '../../UI/ContextMenu';
import { Pencil, Copy, Trash2 } from 'lucide-react';

interface RoutineCardProps {
    routine: Routine;
    isExpanded: boolean;
    library: ExerciseLibraryItem[];
    onToggleExpand: (id: string) => void;
    onEdit: (routine: Routine) => void;
    onDelete: (id: string, e: React.MouseEvent) => void;
    onDuplicate: (routine: Routine, e: React.MouseEvent) => void;
    isCreating?: boolean;
}

export const RoutineCard: React.FC<RoutineCardProps> = ({
    routine,
    isExpanded,
    library,
    onToggleExpand,
    onEdit,
    onDuplicate,
    onDelete,
    isCreating
}) => {
    const muscles: string[] = [];
    const secMuscles: string[] = [];
    (routine.exercises || []).forEach((ex: any) => {
        const libDef = library.find(l => l.id === ex.exId);
        if (libDef) {
            if (libDef.muscles) {
                libDef.muscles.forEach((mId: string) => muscles.push(mId));
            }
            if (libDef.secondaryMuscles) {
                libDef.secondaryMuscles.forEach((mId: string) => secMuscles.push(mId));
            }
        }
    });

    const menuItems: ContextMenuItem[] = [
        {
            id: 'edit-routine',
            label: 'Modifica',
            icon: <Pencil size={16} />,
            disabled: isCreating,
            onClick: () => onEdit(routine)
        },
        {
            id: 'duplicate-routine',
            label: 'Duplica',
            icon: <Copy size={16} />,
            onClick: (e) => onDuplicate(routine, e as any)
        },
        {
            id: 'delete-routine',
            label: 'Elimina',
            icon: <Trash2 size={16} />,
            variant: 'danger',
            onClick: (e) => onDelete(routine.id, e)
        }
    ];

    return (
        <div 
            className="card p-15 mb-0"
            style={{ marginBottom: 0 }}
        >
            <div 
                className="flex-between cursor-pointer"
                onClick={() => onToggleExpand(routine.id)}
            >
                <div>
                    <div className={`font-bold text-lg ${isExpanded ? 'text-primary' : 'text-white'}`}>
                        {routine.name}
                    </div>
                    <div className="text-muted text-sm mt-4">
                        {(routine.exercises || []).length} esercizi
                    </div>
                </div>
                <ContextMenu items={menuItems} />
            </div>

            {isExpanded && (
                <div className="mt-15 pt-15 border-t">
                    <div className="mb-15 flex-center w-full">
                        <MuscleModel 
                            selectedMuscles={Array.from(new Set(muscles)) as string[]} 
                            secondaryMuscles={Array.from(new Set(secMuscles)) as string[]} 
                        />
                    </div>
                    
                    {(routine.exercises || []).length === 0 ? (
                        <p className="text-muted text-md">Nessun esercizio presente.</p>
                    ) : (
                        <div className="flex-col gap-8">
                            {(routine.exercises || []).map((ex: RoutineExercise, index: number) => {
                                const libDef = library.find(l => l.id === ex.exId);
                                return (
                                    <div key={index} className="flex-col bg-card-inner p-10 rounded-8 gap-10">
                                        <div className="flex-between gap-10">
                                            <div className="text-md flex-1">
                                                {index + 1}. {libDef ? libDef.name : 'Esercizio rimosso'}
                                            </div>
                                            <div className="flex items-center gap-5 text-sm text-muted">
                                                {ex.setsCount || 3} serie
                                            </div>
                                        </div>
                                        <div className="flex items-center gap-10 flex-wrap text-sm text-muted">
                                            {(ex.minReps || ex.maxReps) && (
                                                <span>Rep min: {ex.minReps || '-'} | Rep max: {ex.maxReps || '-'}</span>
                                            )}
                                            {ex.defaultTechnique === 'dropset' && (
                                                <span className="badge" style={{ background: 'var(--warning-color)', color: '#000', fontWeight: 600 }}><span aria-hidden="true">🔻</span> Dropset</span>
                                            )}
                                            {ex.defaultTechnique === 'isometrics' && (
                                                <span className="badge" style={{ background: 'var(--accent-color)', color: '#fff', fontWeight: 600 }}><span aria-hidden="true">⏱️</span> Isometria</span>
                                            )}
                                        </div>
                                    </div>
                                );
                            })}
                        </div>
                    )}
                </div>
            )}
        </div>
    );
};


