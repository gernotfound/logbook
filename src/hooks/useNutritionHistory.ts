import { useMemo } from 'react';
import { useAppStore } from '../store/useAppStore';
import { selectNutritionHistory } from '../lib/nutrition/nutritionHistory';

export function useNutritionHistory() {
    const nutrition = useAppStore(state => state.userData?.nutrition);
    const nutritionHistory = useMemo(() => selectNutritionHistory(nutrition), [nutrition]);

    return { nutritionHistory };
}
