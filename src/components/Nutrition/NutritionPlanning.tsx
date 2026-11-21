import { useNutritionPlanning } from '../../hooks/useNutritionPlanning';
import { NutritionPlanningForm } from './NutritionPlanningForm';

export default function NutritionPlanning() {
    const editor = useNutritionPlanning();
    return <NutritionPlanningForm editor={editor} />;
}
