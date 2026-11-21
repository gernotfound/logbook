import { useAppStore } from '../store/useAppStore';
import { useDialogStore } from '../store/useDialogStore';
import { captureSession, isCurrentSession } from '../lib/sync/session';
import { useProfileEditor } from './profile/useProfileEditor';

/** Legacy guest/Firebase adapter. Domain edits are committed only by the
 * existing store owner; Kinde must use its independent, trusted realm adapter.
 */
export function useSettingsProfile() {
    const storeProfile = useAppStore(state => state.userData?.profile);
    const dataOwner = useAppStore(state => state.dataOwner);
    const dispatchDomainOperation = useAppStore(state => state.dispatchDomainOperation);
    const showAlert = useDialogStore(state => state.showAlert);
    let visibleOwner: string | null = null;
    try { visibleOwner = captureSession().owner; }
    catch { /* Unreadable ownership must not expose a previous profile. */ }
    const owner = visibleOwner !== null && dataOwner === visibleOwner ? visibleOwner : null;

    return useProfileEditor({
        owner,
        profile: owner ? storeProfile : undefined,
        capture: () => {
            const session = captureSession();
            if (useAppStore.getState().dataOwner !== session.owner) return null;
            return { owner: session.owner, isCurrent: () => isCurrentSession(session) };
        },
        dispatch: dispatchDomainOperation,
    }, showAlert);
}
