import { useAppStore } from '../store/useAppStore';
import { useDialogStore } from '../store/useDialogStore';
import { captureSession, isCurrentSession } from '../lib/sync/session';
import { useNutritionPlanningEditor } from './useNutritionPlanningEditor';

/** Guest and legacy account adapter. The Kinde realm supplies its own writer. */
export function useNutritionPlanning() {
    const dataOwner = useAppStore(state => state.dataOwner);
    const nutritionPlanning = useAppStore(state => state.userData?.nutritionPlanning);
    const nutrition = useAppStore(state => state.userData?.nutrition);
    const profile = useAppStore(state => state.userData?.profile);
    const dispatchDomainOperation = useAppStore(state => state.dispatchDomainOperation);
    const showAlert = useDialogStore(state => state.showAlert);

    let owner: string | null = null;
    try {
        const visibleOwner = captureSession().owner;
        if (visibleOwner === dataOwner) owner = visibleOwner;
    } catch { /* Unreadable ownership must not expose a previous user's data. */ }

    return useNutritionPlanningEditor({
        owner,
        data: owner ? { nutritionPlanning, nutrition, profile } : undefined,
        capture: () => {
            try {
                const session = captureSession();
                const isCurrent = () => isCurrentSession(session)
                    && useAppStore.getState().dataOwner === session.owner;
                return isCurrent() ? { owner: session.owner, isCurrent } : null;
            } catch { return null; }
        },
        dispatch: async operation => {
            const result = await dispatchDomainOperation(operation);
            if (result.ok) return 'durable';
            if (result.status === 'local-pending') return 'local-pending';
            throw result.error;
        },
    }, showAlert);
}
