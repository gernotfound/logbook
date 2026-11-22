import { Logic } from '../lib/logic';
import { dispatchDurableOperation } from '../lib/sync/dispatchDurableOperation';
import { captureSession, isCurrentSession } from '../lib/sync/session';
import { useAppStore } from '../store/useAppStore';
import { useDialogStore } from '../store/useDialogStore';
import { useNutritionMealEditor } from './useNutritionMealEditor';

export function captureNutritionStoreSession() {
    try {
        const session = captureSession();
        return { isCurrent: () => isCurrentSession(session) };
    } catch {
        return null;
    }
}

export function useNutritionMeals(dateStr?: string) {
    const date = dateStr || Logic.getLocalDateString();
    const day = useAppStore(state => state.userData?.nutrition?.[date]);
    const customFoods = useAppStore(state => state.userData?.customFoods);
    const planning = useAppStore(state => state.userData?.nutritionPlanning);
    const nutrition = useAppStore(state => state.userData?.nutrition);
    const dispatch = useAppStore(state => state.dispatchDomainOperation);
    const showAlert = useDialogStore(state => state.showAlert);

    return useNutritionMealEditor(date, {
        day, customFoods, planning, nutrition,
        capture: captureNutritionStoreSession,
        dispatch: operation => dispatchDurableOperation(dispatch, operation),
    }, showAlert);
}
