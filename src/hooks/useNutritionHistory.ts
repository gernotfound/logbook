import { useMemo } from 'react';
import type { NutritionDay } from '../types';
import { useAppStore } from '../store/useAppStore';

const EMPTY_NUTRITION: Record<string, NutritionDay> = {};

export function useNutritionHistory() {
    const nutrition = useAppStore(state => state.userData?.nutrition ?? EMPTY_NUTRITION);

    const nutritionHistory = useMemo(() => {
        return Object.values(nutrition)
            .filter((day): day is NutritionDay => Boolean(day?.meals?.length))
            .sort((a, b) => b.date.localeCompare(a.date));
    }, [nutrition]);

    return { nutritionHistory };
}
