import { useNutritionSupplementEditor } from '../../hooks/useNutritionSupplementEditor';
import { captureNutritionStoreSession } from '../../hooks/useNutritionMeals';
import { useSupplements } from '../../hooks/useSupplements';
import { NutritionSupplementsForm } from './NutritionSupplementsForm';

export default function NutritionSupplements({
    selectedDate, setSelectedDate,
}: {
    selectedDate?: string;
    setSelectedDate?: (date: string) => void;
}) {
    const source = useSupplements(selectedDate);
    const editor = useNutritionSupplementEditor({
        library: source.supplementsLibrary,
        intakes: source.supplementsIntake,
        actions: source,
        capture: captureNutritionStoreSession,
    });

    return <NutritionSupplementsForm editor={editor} date={source.targetDateStr} setSelectedDate={setSelectedDate} />;
}
