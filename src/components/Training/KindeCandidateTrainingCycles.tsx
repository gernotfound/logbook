import { useRef } from 'react';
import type { useKindeCandidateFitnessLifecycle } from '../../contexts/auth/useKindeCandidateFitnessLifecycle';
import type { DomainOperation } from '../../lib/sync/domainOperations';
import { generateId } from '../../lib/utils/date';
import { useDialogStore } from '../../store/useDialogStore';
import type { TrainingCycle } from '../../types';
import { CycleCard } from './planning/CycleCard';
import './planning/planning-redesign.css';

export function KindeCandidateTrainingCycles({ realm }: { realm: ReturnType<typeof useKindeCandidateFitnessLifecycle> }) {
    const pending = useRef(false);
    const showConfirm = useDialogStore(state => state.showConfirm);
    const showAlert = useDialogStore(state => state.showAlert);
    if (realm.state.phase !== 'ready') return null;
    const { trainingCycles = [], routines = [], activeCycleId = null } = realm.state.snapshot.data;

    const run = async (prepare: () => DomainOperation, errorMessage: string, confirmation?: string) => {
        if (pending.current) return;
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

    return (
        <section className="planning-page planning-cycle-archive" aria-label="Cicli di allenamento account">
            <header className="planning-section-head"><h2>I tuoi cicli</h2></header>
            {trainingCycles.length === 0 ? (
                <p className="planning-empty-inline">Nessun ciclo salvato.</p>
            ) : (
                <div className="planning-cycle-list">
                    {trainingCycles.map(cycle => (
                        <CycleCard key={cycle.id} cycle={cycle} isActive={cycle.id === activeCycleId} routines={routines}
                            onSetActive={id => changeActiveCycle(id, false)}
                            onDeactivate={id => changeActiveCycle(id, true)}
                            onDuplicate={duplicate} onDelete={remove} />
                    ))}
                </div>
            )}
        </section>
    );
}
