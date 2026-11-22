import { captureNutritionStoreSession, useNutritionMeals } from '../../hooks/useNutritionMeals';
import { useSupplements } from '../../hooks/useSupplements';
import { useAppStore } from '../../store/useAppStore';
import { NutritionMealsForm } from './NutritionMealsForm';

type MealsProps = {
    mealsHook?: ReturnType<typeof useNutritionMeals>;
    selectedDate?: string;
    setSelectedDate?: (date: string) => void;
};

export default function NutritionMeals(props: MealsProps) {
    if (props.mealsHook) return <NutritionMealsFromStore {...props} hook={props.mealsHook} />;
    return <StandaloneNutritionMeals {...props} />;
}

function StandaloneNutritionMeals(props: MealsProps) {
    const hook = useNutritionMeals(props.selectedDate);
    return <NutritionMealsFromStore {...props} hook={hook} />;
}

function NutritionMealsFromStore({
    hook, selectedDate, setSelectedDate,
}: MealsProps & { hook: ReturnType<typeof useNutritionMeals> }) {
    const { removeIntake, supplementsLibrary } = useSupplements(selectedDate);
    const dataOwner = useAppStore(state => state.dataOwner);
    return <NutritionMealsForm hook={hook} dataOwner={dataOwner} capture={captureNutritionStoreSession}
        supplementsLibrary={supplementsLibrary} removeIntake={removeIntake} setSelectedDate={setSelectedDate} />;
}
