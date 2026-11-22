import { useState, type ReactNode } from 'react';
import type { useKindeAccountSession } from '../../contexts/auth/useKindeAccountSession';
import { useKindeCandidateFitnessLifecycle } from '../../contexts/auth/useKindeCandidateFitnessLifecycle';
import { KindeCandidateBiometry } from '../Data/KindeCandidateBiometry';
import { KindeCandidateNutritionMeals } from '../Nutrition/KindeCandidateNutritionMeals';
import { KindeCandidateNutritionPlanning } from '../Nutrition/KindeCandidateNutritionPlanning';
import { KindeCandidateJournalStatus } from './KindeCandidateJournalStatus';
import { KindeCandidateTrainingHistory } from '../Training/KindeCandidateTrainingHistory';

type Session = ReturnType<typeof useKindeAccountSession>;

/** Mounted only by the isolated account entry after consent. */
export function KindeCandidateFitnessPanel({ session, management }: { session: Session; management: ReactNode }) {
    const realm = useKindeCandidateFitnessLifecycle({ session, enabled: !session.busy });
    const [failed, setFailed] = useState(false);
    const { phase } = realm.state;
    const run = (action: () => Promise<void>) => {
        setFailed(false);
        void action().catch(() => setFailed(true));
    };

    return (
        <section aria-label="Archivio account cifrato">
            {phase === 'closed' ? (
                <>
                    <button type="button" className="btn btn-primary" disabled={session.busy}
                        onClick={() => run(realm.open)}>Apri archivio account</button>
                    {management}
                </>
            ) : (
                <>
                    {phase === 'opening' && <p role="status">Verifica dell’archivio in corso…</p>}
                    {phase === 'recheck-required' && (
                        <button type="button" className="btn btn-primary" onClick={() => run(realm.recheck)}>
                            Verifica salvataggio
                        </button>
                    )}
                    {phase !== 'opening' && (
                        <button type="button" className="btn" onClick={() => {
                            setFailed(false);
                            realm.suspend();
                        }}>Torna alla gestione account</button>
                    )}
                    <KindeCandidateJournalStatus state={realm.state} />
                    {phase !== 'unavailable' && <>
                        <KindeCandidateBiometry realm={realm} />
                        {phase === 'ready' && <KindeCandidateNutritionPlanning realm={realm} />}
                        <KindeCandidateNutritionMeals realm={realm} />
                        {phase === 'ready' && <KindeCandidateTrainingHistory realm={realm} />
                    </>}
                </>
            )}
            {(failed || phase === 'unavailable') && (
                <p role="alert">Impossibile verificare l’archivio. Riprova dopo aver verificato la sessione.</p>
            )}
        </section>
    );
}
