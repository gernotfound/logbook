import { useState } from 'react';
import type { useKindeCandidateFitnessLifecycle } from '../../contexts/auth/useKindeCandidateFitnessLifecycle';
import { RoutineLibraryList } from './routines/RoutineLibraryList';
import './routines/routines.css';

type Realm = ReturnType<typeof useKindeCandidateFitnessLifecycle>;

/** The Kinde archive reads only this owner's verified snapshot, never the guest store. */
export function KindeCandidateRoutines({ realm }: { realm: Realm }) {
    const [expandedRoutineId, setExpandedRoutineId] = useState<string | null>(null);
    if (realm.state.phase !== 'ready') return null;

    const { routines = [], library = [] } = realm.state.snapshot.data;
    return (
        <section className="training-sub-view active training-routines-page" aria-label="Schede allenamento account">
            <header className="routine-library-header">
                <h2>Schede</h2>
            </header>
            <RoutineLibraryList
                routines={routines}
                library={library}
                expandedRoutineId={expandedRoutineId}
                onToggleExpand={id => setExpandedRoutineId(current => current === id ? null : id)}
            />
        </section>
    );
}
