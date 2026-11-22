import { useRef, useState, type MouseEvent } from 'react';
import type { useKindeCandidateFitnessLifecycle } from '../../contexts/auth/useKindeCandidateFitnessLifecycle';
import { generateId } from '../../lib/utils/date';
import { generateUniqueName } from '../../lib/utils/string';
import { useDialogStore } from '../../store/useDialogStore';
import type { WorkoutRoutine } from '../../types';
import { RoutineLibraryList } from './routines/RoutineLibraryList';
import './routines/routines.css';

type Realm = ReturnType<typeof useKindeCandidateFitnessLifecycle>;

/** Only the trusted Kinde realm may mutate routines; the guest draft writer is never mounted. */
export function KindeCandidateRoutines({ realm }: { realm: Realm }) {
    const [expandedRoutineId, setExpandedRoutineId] = useState<string | null>(null);
    const [searchQuery, setSearchQuery] = useState('');
    const operationInFlight = useRef(false);
    const showConfirm = useDialogStore(state => state.showConfirm);
    const showAlert = useDialogStore(state => state.showAlert);
    if (realm.state.phase !== 'ready') return null;

    const { routines = [], library = [] } = realm.state.snapshot.data;

    const duplicate = async (routine: WorkoutRoutine) => {
        if (operationInFlight.current) return;
        const witness = realm.captureEditWitness();
        if (!witness?.isCurrent()) return;
        operationInFlight.current = true;
        try {
            const copy: WorkoutRoutine = {
                ...structuredClone(routine),
                id: generateId('rtn'),
                name: generateUniqueName(routine.name, routines.map(item => item.name)),
            };
            if (!witness.isCurrent()) return;
            await realm.submit({ type: 'routine.upsert', routine: copy });
            // Receipt/pending status belongs to the realm, never this callback.
        } catch {
            if (witness.isCurrent()) await showAlert('Impossibile duplicare la scheda.');
        } finally {
            operationInFlight.current = false;
        }
    };

    const remove = async (id: string, event: MouseEvent) => {
        event.stopPropagation();
        if (operationInFlight.current || !routines.some(routine => routine.id === id)) return;
        const witness = realm.captureEditWitness();
        if (!witness?.isCurrent()) return;
        operationInFlight.current = true;
        try {
            const confirmed = await showConfirm('Sei sicuro di voler eliminare questa scheda?');
            // A confirmation from a previous owner, epoch or consent generation
            // cannot authorize a new intent even if the routine ID still matches.
            if (!confirmed || !witness.isCurrent()) return;
            await realm.submit({ type: 'routine.delete', id });
        } catch {
            if (witness.isCurrent()) await showAlert('Impossibile eliminare la scheda.');
        } finally {
            operationInFlight.current = false;
        }
    };

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
                searchQuery={searchQuery}
                onSearchQueryChange={setSearchQuery}
                onDuplicate={routine => { void duplicate(routine); }}
                onDelete={(id, event) => { void remove(id, event); }}
            />
        </section>
    );
}
