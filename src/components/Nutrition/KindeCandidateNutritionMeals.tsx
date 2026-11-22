import { useState } from 'react';
import type { useKindeCandidateFitnessLifecycle } from '../../contexts/auth/useKindeCandidateFitnessLifecycle';
import { useLocalToday } from '../../hooks/useLocalToday';
import { useNutritionMealEditor } from '../../hooks/useNutritionMealEditor';
import { useDialogStore } from '../../store/useDialogStore';
import { NutritionMealsForm } from './NutritionMealsForm';
import './TrackingViews.css';

type Realm = ReturnType<typeof useKindeCandidateFitnessLifecycle>;

export function KindeCandidateNutritionMeals({ realm }: { realm: Realm }) {
    const today = useLocalToday();
    const [chosenDate, setChosenDate] = useState<string | null>(null);
    const date = chosenDate ?? today;
    const showAlert = useDialogStore(state => state.showAlert);
    const snapshot = realm.state.phase === 'ready' ? realm.state.snapshot : null;
    const data = snapshot?.data;
    const editor = useNutritionMealEditor(date, {
        day: data?.nutrition?.[date],
        customFoods: data?.customFoods,
        planning: data?.nutritionPlanning,
        nutrition: data?.nutrition,
        capture: realm.captureEditWitness,
        // The panel reports pending and receipt status for every editor.
        dispatch: async operation => { await realm.submit(operation); },
    }, showAlert);

    if (!snapshot) return null;
    const removeIntake = async (intakeId: string) => {
        const witness = realm.captureEditWitness();
        if (!witness?.isCurrent()) return;
        try {
            await realm.submit({ type: 'supplement-intake.delete', date, intakeId });
        } catch {
            if (witness.isCurrent()) await showAlert("Errore durante la rimozione dell'assunzione.");
        }
    };
    return (
        <section aria-label="Diario pasti">
            <h2>Diario pasti</h2>
            <NutritionMealsForm hook={editor} dataOwner={snapshot.owner} capture={realm.captureEditWitness}
                supplementsLibrary={snapshot.data.supplements ?? []} removeIntake={removeIntake}
                setSelectedDate={selected => setChosenDate(selected === today ? null : selected)} />
        </section>
    );
}
