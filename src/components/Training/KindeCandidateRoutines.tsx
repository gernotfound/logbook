import { useRef, useState, type MouseEvent } from 'react';
import { Plus } from 'lucide-react';
import type { useKindeCandidateFitnessLifecycle } from '../../contexts/auth/useKindeCandidateFitnessLifecycle';
import type { KindeRoutineDraft } from '../../lib/auth/kindeCandidateRoutineDraft';
import { generateId } from '../../lib/utils/date';
import { buildRoutineDuplicateOperation } from '../../lib/routineSaveIntent';
import { useDialogStore } from '../../store/useDialogStore';
import type { WorkoutRoutine } from '../../types';
import { RoutineLibraryList } from './routines/RoutineLibraryList';
import { KindeRoutineEditor } from './routines/KindeRoutineEditor';
import './routines/routines.css';

type Realm = ReturnType<typeof useKindeCandidateFitnessLifecycle>;

export function KindeCandidateRoutines({ realm }: { realm: Realm }) {
    const [expandedRoutineId, setExpandedRoutineId] = useState<string | null>(null);
    const [searchQuery, setSearchQuery] = useState('');
    const operationInFlight = useRef(false);
    const [editing, setEditing] = useState<{ draft: KindeRoutineDraft; isCurrent: () => boolean } | null>(null);
    const [opening, setOpening] = useState(false);
    const showConfirm = useDialogStore(state => state.showConfirm);
    const showAlert = useDialogStore(state => state.showAlert);
    if (realm.state.phase !== 'ready') return null;

    const { routines = [], library = [] } = realm.state.snapshot.data;

    const openEditor = async (routineId?: string) => {
        if (operationInFlight.current) return;
        const witness = realm.captureEditWitness();
        if (!witness?.isCurrent()) return;
        operationInFlight.current = true;
        setOpening(true);
        try {
            const draft = await realm.openRoutineDraft(routineId);
            if (!witness.isCurrent()) {
                draft.close();
                return;
            }
            setEditing({ draft, isCurrent: witness.isCurrent });
        } catch {
            if (witness.isCurrent()) await showAlert(routineId === undefined
                ? 'Impossibile aprire la bozza della scheda. Le copie sul dispositivo sono conservate.'
                : 'Impossibile aprire la scheda. Usa «Crea o riprendi scheda» per verificare la bozza in corso.');
        } finally {
            operationInFlight.current = false;
            setOpening(false);
        }
    };

    const closeEditor = () => {
        editing?.draft.close();
        setEditing(null);
    };

    const duplicate = async (routine: WorkoutRoutine) => {
        if (operationInFlight.current) return;
        const witness = realm.captureEditWitness();
        if (!witness?.isCurrent()) return;
        operationInFlight.current = true;
        try {
            const operation = buildRoutineDuplicateOperation(routine, routines, generateId('rtn'));
            if (!witness.isCurrent()) return;
            await realm.submit(operation);
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
                {!editing && <button type="button" className="btn btn-primary routine-create-button"
                    disabled={opening} onClick={() => { void openEditor(); }}>
                    <Plus size={18} aria-hidden="true" /> Crea o riprendi scheda
                </button>}
            </header>
            {editing ? <KindeRoutineEditor
                draft={editing.draft}
                library={library}
                isCurrent={editing.isCurrent}
                onClose={closeEditor}
                onSave={async () => {
                    const result = await realm.saveRoutineDraft(editing.draft);
                    if (!result.draftCleared && editing.isCurrent()) {
                        await showAlert('Scheda salvata. La bozza sul dispositivo richiede una verifica.');
                    }
                }}
            /> : <RoutineLibraryList
                routines={routines}
                library={library}
                expandedRoutineId={expandedRoutineId}
                onToggleExpand={id => setExpandedRoutineId(current => current === id ? null : id)}
                searchQuery={searchQuery}
                onSearchQueryChange={setSearchQuery}
                onEdit={routine => { void openEditor(routine.id); }}
                onDuplicate={routine => { void duplicate(routine); }}
                onDelete={(id, event) => { void remove(id, event); }}
            />}
        </section>
    );
}
