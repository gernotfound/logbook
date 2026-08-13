import { useMemo } from 'react';
import { useAppStore } from '../store/useAppStore';

const EMPTY_NUTRITION = {};

export function useNutritionHistory() {
    const nutrition = useAppStore(state => state.userData?.nutrition || EMPTY_NUTRITION);

    const nutritionHistory = useMemo(() => {
        return Object.values(nutrition)
            .filter((day: any) => day && day.meals && day.meals.length > 0)
            .sort((a: any, b: any) => (b.date || '').localeCompare(a.date || ''));
    }, [nutrition]);

    return { nutritionHistory };
}
