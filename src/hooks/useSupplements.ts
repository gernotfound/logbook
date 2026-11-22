import { useAppStore } from '../store/useAppStore';
import { dispatchDurableOperation } from '../lib/sync/dispatchDurableOperation';
import { useDialogStore } from '../store/useDialogStore';
import { getLocalDateString } from '../lib/utils/date';
import { createSupplementActions, EMPTY_INTAKES, EMPTY_SUPPLEMENTS } from '../lib/nutrition/supplementActions';
import { captureNutritionStoreSession } from './useNutritionMeals';

export function useSupplements(dateStr?: string) {
    const targetDateStr = dateStr || getLocalDateString();

    const supplementsLibrary = useAppStore(state => state.userData?.supplements || EMPTY_SUPPLEMENTS);
    const todayNutrition = useAppStore(state => state.userData?.nutrition?.[targetDateStr]);
    const supplementsIntake = todayNutrition?.supplementsIntake || EMPTY_INTAKES;

    const dispatchDomainOperation = useAppStore(state => state.dispatchDomainOperation);
    const showAlert = useDialogStore(state => state.showAlert);
    return {
        targetDateStr,
        supplementsLibrary,
        supplementsIntake,
        ...createSupplementActions(targetDateStr, {
            capture: captureNutritionStoreSession,
            dispatch: operation => dispatchDurableOperation(dispatchDomainOperation, operation),
            showAlert,
        }),
    };
}
