import type { useKindeCandidateFitnessLifecycle } from '../../contexts/auth/useKindeCandidateFitnessLifecycle';
import { useKindeCandidateProfile } from '../../hooks/profile/useKindeCandidateProfile';
import DataBiometry from './DataBiometry';

type Realm = ReturnType<typeof useKindeCandidateFitnessLifecycle>;

/** The verified realm owns both the visible profile and its writer. */
export function KindeCandidateBiometry({ realm }: { realm: Realm }) {
    const editor = useKindeCandidateProfile(realm);
    return realm.state.phase === 'ready' ? <DataBiometry editor={editor} /> : null;
}
