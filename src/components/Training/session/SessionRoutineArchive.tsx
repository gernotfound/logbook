import { useMemo, useState } from 'react';
import { ChevronRight, Search } from 'lucide-react';
import type { WorkoutRoutine } from '../../../types';
import type { RoutineDurationEstimate } from './sessionDurationEstimate';

function routineExerciseLabel(routine: WorkoutRoutine): string {
    const count = routine.exercises?.length ?? 0;
    return `${count} ${count === 1 ? 'esercizio' : 'esercizi'}`;
}

interface SessionRoutineArchiveProps {
    routines: WorkoutRoutine[];
    durationEstimates: ReadonlyMap<string, RoutineDurationEstimate>;
    onStartRoutine: (routineId: string) => void;
}

export function SessionRoutineArchive({ routines, durationEstimates, onStartRoutine }: SessionRoutineArchiveProps) {
    const [searchQuery, setSearchQuery] = useState('');
    const normalizedQuery = searchQuery.trim().toLocaleLowerCase('it');
    const filteredRoutines = useMemo(() => (
        normalizedQuery
            ? routines.filter(routine => routine.name.toLocaleLowerCase('it').includes(normalizedQuery))
            : routines
    ), [normalizedQuery, routines]);

    const renderRoutineRow = (routine: WorkoutRoutine) => {
        const estimate = durationEstimates.get(routine.id);
        return (
            <button
                key={routine.id}
                type="button"
                className="session-routine-row"
                onClick={() => onStartRoutine(routine.id)}
            >
                <span className="session-routine-mark" aria-hidden="true">
                    {routine.name.slice(0, 1).toUpperCase()}
                </span>
                <span className="session-routine-copy">
                    <strong>{routine.name}</strong>
                    <span>
                        {routineExerciseLabel(routine)}
                        {estimate ? ` · ≈ ${estimate.minutes} min` : ''}
                    </span>
                    {estimate && (
                        <small>Stima: mediana ultime {estimate.sampleSize} sessioni</small>
                    )}
                </span>
                <ChevronRight size={20} aria-hidden="true" />
            </button>
        );
    };

    return (
        <section className="session-archive-section" aria-labelledby="session-archive-title">
            <div className="session-section-heading">
                <div>
                    <h2 id="session-archive-title">Scegli dall’archivio</h2>
                    <p>{routines.length} {routines.length === 1 ? 'scheda' : 'schede'}</p>
                </div>
            </div>

            <label className="session-search-field">
                <Search size={20} aria-hidden="true" />
                <span className="sr-only">Cerca scheda per nome</span>
                <input
                    type="search"
                    value={searchQuery}
                    onChange={event => setSearchQuery(event.target.value)}
                    placeholder="Cerca scheda per nome"
                />
            </label>

            {filteredRoutines.length > 0 ? (
                <div className="session-routine-list">
                    {filteredRoutines.map(routine => renderRoutineRow(routine))}
                </div>
            ) : (
                <div className="session-setup-message">Nessuna scheda trovata.</div>
            )}
        </section>
    );
}
