import { useRef } from 'react';
import type { useKindeCandidateFitnessLifecycle } from '../../contexts/auth/useKindeCandidateFitnessLifecycle';
import { useDialogStore } from '../../store/useDialogStore';
import { CycleCard } from './planning/CycleCard';
import './planning/planning-redesign.css';

export function KindeCandidateTrainingCycles({ realm }: { realm: ReturnType<typeof useKindeCandidateFitnessLifecycle> }) {
    const pending = useRef(false);
    const showConfirm = useDialogStore(state => state.showConfirm);
    const showAlert = useDialogStore(state => state.showAlert);
    if (realm.state.phase !== 'ready') return null;
    const { trainingCycles = [], routines = [], activeCycleId = null } = realm.state.snapshot.data;

    const changeActiveCycle = async (cycleId: string, deactivate: boolean) => {
        if (pending.current || (deactivate && cycleId !== activeCycleId)) return;
        const witness = realm.captureEditWitness();
        if (!witness?.isCurrent()) return;
        pending.current = true;
        try {
            if (deactivate && !(await showConfirm('Disattivare il ciclo corrente?'))) return;
            if (!witness.isCurrent()) return;
            await realm.submit({
                type: 'active-cycle.switch',
                id: deactivate ? null : cycleId,
                expectedActiveId: activeCycleId,
            });
        } catch {
            if (witness.isCurrent()) await showAlert('Impossibile cambiare il ciclo attivo. Verifica l’archivio.');
        } finally {
            pending.current = false;
        }
    };

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
                            onDeactivate={id => changeActiveCycle(id, true)} />
                    ))}
                </div>
            )}
        </section>
    );
}
