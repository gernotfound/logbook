import type { useKindeCandidateFitnessLifecycle } from '../../contexts/auth/useKindeCandidateFitnessLifecycle';
import { useDialogStore } from '../../store/useDialogStore';
import { useProfileEditor } from './useProfileEditor';

type AccountRealm = ReturnType<typeof useKindeCandidateFitnessLifecycle>;

/**
 * Same biometric editor as guest, but this writer belongs solely to the
 * verified Kinde realm. No Firebase AuthContext, global Zustand userData
 * or legacy sync can serve as a fallback while account access is suspended.
 *
 * This adapter remains candidate-only until the complete account UI is
 * mounted with the required offline, rights and session guarantees.
 */
export function useKindeCandidateProfile(realm: AccountRealm) {
    const showAlert = useDialogStore(state => state.showAlert);
    const ready = realm.state.phase === 'ready' ? realm.state : null;
    return useProfileEditor({
        owner: ready?.snapshot.owner ?? null,
        profile: ready?.snapshot.data.profile,
        capture: realm.captureEditWitness,
        dispatch: async operation => {
            // Every resolution proves a locally durable intent or a no-op.
            // Only the realm may report a receipt and clear its pending state.
            await realm.submit(operation);
        },
    }, showAlert);
}
