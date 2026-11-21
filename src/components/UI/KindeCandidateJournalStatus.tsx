import type { useKindeCandidateFitnessLifecycle } from '../../contexts/auth/useKindeCandidateFitnessLifecycle';

type State = ReturnType<typeof useKindeCandidateFitnessLifecycle>['state'];

/** A shared status for all editors in the same verified archive. */
export function KindeCandidateJournalStatus({ state }: { state: State }) {
    if (state.phase !== 'recheck-required' && (state.phase !== 'ready' || !state.hasPendingJournal)) return null;
    return <p role="status">Modifiche salvate sul dispositivo. Conferma cloud in attesa.</p>;
}
