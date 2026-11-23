import { useId, useMemo, useState } from 'react';
import type { useKindeCandidateFitnessLifecycle } from '../../contexts/auth/useKindeCandidateFitnessLifecycle';
import { useLocalToday } from '../../hooks/useLocalToday';
import { useNutritionFoodArchive } from '../../hooks/useNutritionFoodArchive';
import { useNutritionMealEditor } from '../../hooks/useNutritionMealEditor';
import { useNutritionSupplementEditor } from '../../hooks/useNutritionSupplementEditor';
import { selectNutritionHistory } from '../../lib/nutrition/nutritionHistory';
import { createSupplementActions, EMPTY_INTAKES, EMPTY_SUPPLEMENTS } from '../../lib/nutrition/supplementActions';
import type { DomainOperation } from '../../lib/sync/domainOperations';
import { useDialogStore } from '../../store/useDialogStore';
import SubNav from '../UI/SubNav';
import { NutritionFoodArchiveForm } from './NutritionFoodArchiveForm';
import NutritionHistory, { NUTRITION_HISTORY_PAGE_SIZE } from './NutritionHistory';
import { NutritionMealsForm } from './NutritionMealsForm';
import { NutritionSupplementsForm } from './NutritionSupplementsForm';
import './TrackingViews.css';

type Realm = ReturnType<typeof useKindeCandidateFitnessLifecycle>;

const DIARY_TABS = [
    { id: 'meals', label: 'Pasti' },
    { id: 'history', label: 'Storico' },
    { id: 'supplements', label: 'Integratori' },
    { id: 'foods', label: 'Alimenti' },
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
    const day = data?.nutrition?.[date];
    const supplements = data?.supplements ?? EMPTY_SUPPLEMENTS;
    const historySource = tab === 'history' ? data?.nutrition : undefined;
    const history = useMemo(() => selectNutritionHistory(historySource), [historySource]);
    // The panel reports pending and receipt status for every editor.
    const dispatch = async (operation: DomainOperation) => { await realm.submit(operation); };
    const editor = useNutritionMealEditor(date, {
        day,
        customFoods: data?.customFoods,
        planning: data?.nutritionPlanning,
        nutrition: data?.nutrition,
        capture: realm.captureEditWitness,
        dispatch,
    }, showAlert);
    const supplementActions = createSupplementActions(date, { capture: realm.captureEditWitness, dispatch, showAlert });
    const supplementEditor = useNutritionSupplementEditor({
        library: supplements,
        intakes: day?.supplementsIntake ?? EMPTY_INTAKES,
        actions: supplementActions,
        capture: realm.captureEditWitness,
    });
    const foodArchive = useNutritionFoodArchive({
        foods: data?.customFoods, capture: realm.captureEditWitness, dispatch,
    });

    if (!snapshot) return null;
    return (
        <section aria-label="Diario pasti">
            <h2>Diario pasti</h2>
            <SubNav id={diaryId} label="Diario pasti" items={DIARY_TABS} value={tab} onChange={setTab} />
            <div key={tab} role="tabpanel" id={`${diaryId}-panel-${tab}`} aria-labelledby={`${diaryId}-tab-${tab}`}>
                {tab === 'meals' && <NutritionMealsForm hook={editor} dataOwner={snapshot.owner}
                    capture={realm.captureEditWitness} supplementsLibrary={supplements}
                    removeIntake={supplementActions.removeIntake} setSelectedDate={selectDate} />}
                {tab === 'history' && <NutritionHistory nutritionHistory={history}
                        visibleCount={historyVisibleCount}
                        onShowMore={() => setHistoryVisibleCount(count => count + NUTRITION_HISTORY_PAGE_SIZE)}
                        onDayClick={selected => {
                            selectDate(selected);
                            setTab('meals');
                            document.getElementById(`${diaryId}-tab-meals`)?.focus();
                        }} />}
                {tab === 'supplements' && <NutritionSupplementsForm editor={supplementEditor}
                    date={date} setSelectedDate={selectDate} />}
                {tab === 'foods' && <NutritionFoodArchiveForm editor={foodArchive} />}
            </div>
        </section>
    );
}
