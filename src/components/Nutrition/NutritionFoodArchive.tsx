import { captureNutritionStoreSession } from '../../hooks/useNutritionMeals';
import { useNutritionFoodArchive } from '../../hooks/useNutritionFoodArchive';
import { dispatchDurableOperation } from '../../lib/sync/dispatchDurableOperation';
import { useAppStore } from '../../store/useAppStore';
import type { Food } from '../../types';
import { NutritionFoodArchiveForm } from './NutritionFoodArchiveForm';

export default function NutritionFoodArchive({ onEditFood }: { onEditFood?: (food: Food) => void }) {
    const foods = useAppStore(state => state.userData?.customFoods);
    const dispatch = useAppStore(state => state.dispatchDomainOperation);
    const editor = useNutritionFoodArchive({
        foods, capture: captureNutritionStoreSession, onEditFood,
        dispatch: operation => dispatchDurableOperation(dispatch, operation),
    });
    return <NutritionFoodArchiveForm editor={editor} />;
}
