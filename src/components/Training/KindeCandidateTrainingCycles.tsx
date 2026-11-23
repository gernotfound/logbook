import { useRef, useState } from 'react';
import type { useKindeCandidateFitnessLifecycle } from '../../contexts/auth/useKindeCandidateFitnessLifecycle';
import type { KindeCycleDraft } from '../../lib/auth/kindeCandidateCycleDraft';
import type { DomainOperation } from '../../lib/sync/domainOperations';
import { generateId } from '../../lib/utils/date';
import { useDialogStore } from '../../store/useDialogStore';
import type { TrainingCycle } from '../../types';
import { CycleCard } from './planning/CycleCard';
import { CycleEditor } from './planning/CycleEditor';
import './planning/planning-redesign.css';

export function KindeCandidateTrainingCycles({ realm }: { realm: ReturnType<typeof useKindeCandidateFitnessLifecycle> }) {
    const pending = useRef(false);
    const [editor, setEditor] = useState<{ draft: KindeCycleDraft; isCurrent: () => boolean } | null>(null);
    const [opening, setOpening] = useState(false);
    const showConfirm = useDialogStore(state => state.showConfirm);
    const showAlert = useDialogStore(state => state.showAlert);
    if (realm.state.phase !== 'ready') return null;
    const { trainingCycles = [], routines = [], library = [], history = [], activeCycleId = null } = realm.state.snapshot.data;

    const open = async (id?: string) => {
        if (pending.current || editor) return;
        const witness = realm.captureEditWitness();
        if (!witness?.isCurrent()) return;
        pending.current = true;
        setOpening(true);
        try {
            const draft = await realm.openCycleDraft(id);
            if (!witness.isCurrent()) { draft.close(); return; }
            setEditor({ draft, isCurrent: witness.isCurrent });
        } catch {
            if (witness.isCurrent()) await showAlert('Impossibile aprire il ciclo. Usa “Nuovo o riprendi ciclo” per verificare la bozza.');
        } finally {
            pending.current = false;
            setOpening(false);
        }
    };
    const close = () => {
        if (pending.current || !editor) return;
        editor.draft.close();
        setEditor(null);
    };
    const discard = async () => {
        if (pending.current || !editor?.isCurrent()) return;
        pending.current = true;
        try {
            if (!(await showConfirm('Eliminare la bozza del ciclo da questo dispositivo?')) || !editor.isCurrent()) return;
            editor.draft.discard();
            setEditor(null);
        } catch {
            if (editor.isCurrent()) await showAlert('Impossibile eliminare la bozza. Copia conservata.');
        } finally { pending.current = false; }
    };

    const run = async (prepare: () => DomainOperation, errorMessage: string, confirmation?: string) => {
        if (pending.current || editor) return;
        const witness = realm.captureEditWitness();
        if (!witness?.isCurrent()) return;
        pending.current = true;
        try {
            if (confirmation && !(await showConfirm(confirmation))) return;
            if (!witness.isCurrent()) return;
            await realm.submit(prepare());
        } catch {
            if (witness.isCurrent()) await showAlert(errorMessage);
        } finally {
            pending.current = false;
        }
    };

    const changeActiveCycle = (cycleId: string, deactivate: boolean) => {
        if (deactivate && cycleId !== activeCycleId) return;
        return run(() => ({ type: 'active-cycle.switch', id: deactivate ? null : cycleId,
            expectedActiveId: activeCycleId }),
        'Impossibile cambiare il ciclo attivo. Verifica l’archivio.',
        deactivate ? 'Disattivare il ciclo corrente?' : undefined);
    };
    const duplicate = (source: TrainingCycle) => run(
        () => ({ type: 'training-cycle.duplicate', source, id: generateId('cycle'), createdAt: Date.now() }),
        'Impossibile duplicare il ciclo. Verifica il ciclo e le schede collegate.',
    );
    const remove = (expected: TrainingCycle) => run(
        () => ({ type: 'training-cycle.remove', expected, expectedActiveId: activeCycleId }),
        'Impossibile eliminare il ciclo. Verifica l’archivio.',
        `Eliminare il ciclo “${expected.name}”?`,
    );

    if (editor) {
        const { cycle, values, submitted, stale } = editor.draft.initial;
        const status = submitted
            ? 'Salvataggio già tentato. Verifica l’archivio prima di eliminare la bozza.'
            : stale ? 'Il ciclo originale è cambiato o è stato eliminato. La bozza resta disponibile per la verifica.' : undefined;
        return <section className="planning-page planning-cycle-archive" aria-label="Cicli di allenamento account">
            <CycleEditor initialCycle={cycle} routines={routines} library={library}
                hasRecordedSessions={cycle !== null && history.some(session => session.cycleId === cycle.id)}
                onCancel={close} onDiscardDraft={() => { void discard(); }} draftStatus={status}
                draft={{
                    values,
                    canEdit: !status,
                    write: next => {
                        if (pending.current || !editor.isCurrent()) throw new Error('Sessione ciclo non verificabile.');
                        editor.draft.write(next);
                    },
                    save: async () => {
                        if (pending.current || !editor.isCurrent()) throw new Error('Sessione ciclo non verificabile.');
                        pending.current = true;
                        try {
                            const saved = await realm.saveCycleDraft(editor.draft);
                            if (!saved.draftCleared && editor.isCurrent()) {
                                await showAlert('Ciclo salvato. Verifica la copia di recupero sul dispositivo.');
                            }
                            setEditor(null);
                        } finally { pending.current = false; }
                    },
                }} />
        </section>;
    }

    return (
        <section className="planning-page planning-cycle-archive" aria-label="Cicli di allenamento account">
            <header className="planning-section-head">
                <h2>I tuoi cicli</h2>
                <button type="button" className="btn btn-primary" disabled={opening}
                    onClick={() => { void open(); }}>Nuovo o riprendi ciclo</button>
            </header>
            {trainingCycles.length === 0 ? (
                <p className="planning-empty-inline">Nessun ciclo salvato.</p>
            ) : (
                <div className="planning-cycle-list">
                    {trainingCycles.map(cycle => (
                        <CycleCard key={cycle.id} cycle={cycle} isActive={cycle.id === activeCycleId} routines={routines}
                            onSetActive={id => changeActiveCycle(id, false)}
                            onDeactivate={id => changeActiveCycle(id, true)}
                            onEdit={cycle => open(cycle.id)} onDuplicate={duplicate} onDelete={remove} />
                    ))}
                </div>
            )}
        </section>
    );
}
