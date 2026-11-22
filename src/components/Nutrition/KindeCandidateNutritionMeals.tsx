import { useId, useMemo, useState } from 'react';
import type { useKindeCandidateFitnessLifecycle } from '../../contexts/auth/useKindeCandidateFitnessLifecycle';
import { useLocalToday } from '../../hooks/useLocalToday';
import { useNutritionMealEditor } from '../../hooks/useNutritionMealEditor';
import { selectNutritionHistory } from '../../lib/nutrition/nutritionHistory';
import { useDialogStore } from '../../store/useDialogStore';
import SubNav from '../UI/SubNav';
import NutritionHistory, { NUTRITION_HISTORY_PAGE_SIZE } from './NutritionHistory';
import { NutritionMealsForm } from './NutritionMealsForm';
import './TrackingViews.css';

type Realm = ReturnType<typeof useKindeCandidateFitnessLifecycle>;

const DIARY_TABS = [
    { id: 'meals', label: 'Pasti' },
    { id: 'history', label: 'Storico' },
] as const;
type DiaryTab = typeof DIARY_TABS[number]['id'];

export function KindeCandidateNutritionMeals({ realm }: { realm: Realm }) {
    const today = useLocalToday();
    const diaryId = useId();
    const [chosenDate, setChosenDate] = useState<string | null>(null);
    const [tab, setTab] = useState<DiaryTab>('meals');
    const [historyVisibleCount, setHistoryVisibleCount] = useState(NUTRITION_HISTORY_PAGE_SIZE);
    const date = chosenDate ?? today;
    const selectDate = (selected: string) => setChosenDate(selected === today ? null : selected);
    const showAlert = useDialogStore(state => state.showAlert);
    const snapshot = realm.state.phase === 'ready' ? realm.state.snapshot : null;
    const data = snapshot?.data;
    const historySource = tab === 'history' ? data?.nutrition : undefined;
    const history = useMemo(() => selectNutritionHistory(historySource), [historySource]);
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
            <SubNav id={diaryId} label="Diario pasti" items={DIARY_TABS} value={tab} onChange={setTab} />
            <div key={tab} role="tabpanel" id={`${diaryId}-panel-${tab}`} aria-labelledby={`${diaryId}-tab-${tab}`}>
                {tab === 'meals'
                    ? <NutritionMealsForm hook={editor} dataOwner={snapshot.owner} capture={realm.captureEditWitness}
                        supplementsLibrary={snapshot.data.supplements ?? []} removeIntake={removeIntake}
                        setSelectedDate={selectDate} />
                    : <NutritionHistory nutritionHistory={history}
                        visibleCount={historyVisibleCount}
                        onShowMore={() => setHistoryVisibleCount(count => count + NUTRITION_HISTORY_PAGE_SIZE)}
                        onDayClick={selected => {
                            selectDate(selected);
                            setTab('meals');
                            document.getElementById(`${diaryId}-tab-meals`)?.focus();
                        }} />}
            </div>
        </section>
    );
}
