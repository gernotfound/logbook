import type { SyncResult } from '../../types';
import type { DomainOperationBatch } from '../../lib/sync/domainOperations';
import { KindeCandidateBoundaryError } from '../../lib/auth/kindeCandidateClient';
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
        dispatch: async (operation: DomainOperationBatch): Promise<SyncResult> => {
            const result = await realm.submit(operation);
            if (result.kind === 'local-pending') {
                // The candidate bridge already proved the exact encrypted
                // local journal. This is never a cloud success or fake ACK.
                return {
                    ok: false, status: 'local-pending',
                    error: new Error('Salvato localmente: conferma cloud da riconciliare.'),
                };
            }
            if (result.kind === 'cloud-acknowledged' || result.kind === 'local-only') {
                return { ok: true, status: 'synced' };
            }
            throw new KindeCandidateBoundaryError();
        },
    }, showAlert);
}
