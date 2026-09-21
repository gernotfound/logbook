import { useState } from 'react';
import { useNutritionMeals } from '../../hooks/useNutritionMeals';
import NutritionPlanning from './NutritionPlanning';
import NutritionMeals from './NutritionMeals';
import NutritionFoodArchive from './NutritionFoodArchive';
import NutritionHistory from './NutritionHistory';
import NutritionSupplements from './NutritionSupplements';
import { NutritionConflictBanner } from './NutritionConflictBanner';
import { NutritionConflictDialog } from '../UI/NutritionConflictDialog';
import { useNutritionHistory } from '../../hooks/useNutritionHistory';
import { Logic } from '../../lib/logic';
import { getNutritionConflictFingerprint } from '../../lib/utils/object';
import { useAppStore } from '../../store/useAppStore';
import { useAuth } from '../../hooks/useAuth';
import { useDialogStore } from '../../store/useDialogStore';
import type { NutritionSubTab } from '../../types';
import './TrackingViews.css';
import SubNav from '../UI/SubNav';

const NUTRITION_TABS: ReadonlyArray<{ id: NutritionSubTab; label: string }> = [
    { id: 'meals', label: 'Pasti' },
    { id: 'planning', label: 'Pianificazione' },
    { id: 'supplements', label: 'Integratori' },
    { id: 'archive', label: 'Alimenti' },
    { id: 'history', label: 'Storico' }
];

interface NutritionViewProps {
    subTab?: NutritionSubTab;
    setSubTab?: (tab: NutritionSubTab) => void;
}

const NutritionView = ({ subTab = 'meals', setSubTab }: NutritionViewProps) => {
    const activeSubTab = (subTab === 'planning' || subTab === 'archive' || subTab === 'history' || subTab === 'supplements') ? subTab : 'meals';

    const [selectedDate, setSelectedDate] = useState<string>(Logic.getLocalDateString());
    const mealsHook = useNutritionMeals(selectedDate);
    const historyHook = useNutritionHistory();

    const userData = useAppStore(state => state.userData);
    const resolveConflict = useAppStore(state => state.resolveNutritionConflict);
    const { currentUser } = useAuth();
    const showAlert = useDialogStore(state => state.showAlert);
    const [isConflictDialogOpen, setConflictDialogOpen] = useState(false);
    const [isResolving, setIsResolving] = useState(false);

    const pendingConflict = userData?.pendingConflicts?.nutritionPlanning;

    const handleResolveConflict = async (resolution: 'cloud' | 'local') => {
        if (!currentUser?.uid || !pendingConflict) return;
        setIsResolving(true);
        try {
            const fingerprint = getNutritionConflictFingerprint(pendingConflict);
            const result = await resolveConflict({
                resolution,
                expectedUid: currentUser.uid,
                expectedConflictFingerprint: fingerprint
            });

            if (result.ok) {
                setConflictDialogOpen(false);
            } else if (result.status === 'local-pending') {
                showAlert('Piano locale salvato, in attesa di connessione per la sincronizzazione cloud.', 'warning');
                setConflictDialogOpen(false);
            } else {
                if (result.error instanceof Error && result.error.message === "conflict-resolved-elsewhere") {
                    setConflictDialogOpen(false);
                    return;
                }
                showAlert(`Errore durante il salvataggio: ${result.error}`, 'error');
                // Non chiudiamo il dialog, lasciamo all'utente la possibilità di esportare
            }
        } catch (e: any) {
            showAlert(`Si è verificato un errore: ${e.message}`, 'error');
        } finally {
            setIsResolving(false);
        }
    };

    const handleEditFoodFromArchive = (food: any) => {
        mealsHook.startEditCustomFood(food);
        if (setSubTab) {
            setSubTab('meals');
        }
    };

    const handleHistoryDayClick = (dateStr: string) => {
        setSelectedDate(dateStr);
        if (setSubTab) {
            setSubTab('meals');
        }
    };

    return (
        <div id="view-nutrition" className="view-section active tracking-view">
            {pendingConflict && (
                <NutritionConflictBanner onResolveClick={() => setConflictDialogOpen(true)} />
            )}

            <SubNav
                id="nutrition"
                label="Sotto-menu Nutrizione"
                items={NUTRITION_TABS}
                value={activeSubTab}
                onChange={tab => setSubTab?.(tab)}
            />

            {activeSubTab === 'meals' && (
                <div id="nutrition-panel-meals" role="tabpanel" aria-labelledby="nutrition-tab-meals" className="nutrition-sub-view active">
                    <NutritionMeals
                        mealsHook={{
                            ...mealsHook,
                            saveCustomFood: async () => {
                                const wasEditing = !!mealsHook.editingFoodId;
                                await mealsHook.saveCustomFood();
                                if (wasEditing && setSubTab) setSubTab('archive');
                            },
                            cancelCustomFood: () => {
                                const wasEditing = !!mealsHook.editingFoodId;
                                mealsHook.cancelCustomFood();
                                if (wasEditing && setSubTab) setSubTab('archive');
                            }
                        }}
                        selectedDate={selectedDate}
                        setSelectedDate={setSelectedDate}
                    />
                </div>
            )}

            {activeSubTab === 'planning' && (
                <div id="nutrition-panel-planning" role="tabpanel" aria-labelledby="nutrition-tab-planning" className="nutrition-sub-view active">
                    <NutritionPlanning />
                </div>
            )}

            {activeSubTab === 'archive' && (
                <div id="nutrition-panel-archive" role="tabpanel" aria-labelledby="nutrition-tab-archive" className="nutrition-sub-view active">
                    <NutritionFoodArchive onEditFood={handleEditFoodFromArchive} />
                </div>
            )}

            {activeSubTab === 'history' && (
                <div id="nutrition-panel-history" role="tabpanel" aria-labelledby="nutrition-tab-history" className="nutrition-sub-view active">
                    <NutritionHistory
                        nutritionHistory={historyHook.nutritionHistory}
                        onDayClick={handleHistoryDayClick}
                    />
                </div>
            )}

            {activeSubTab === 'supplements' && (
                <div id="nutrition-panel-supplements" role="tabpanel" aria-labelledby="nutrition-tab-supplements" className="nutrition-sub-view active">
                    <NutritionSupplements
                        selectedDate={selectedDate}
                        setSelectedDate={setSelectedDate}
                    />
                </div>
            )}

            {pendingConflict && (
                <NutritionConflictDialog
                    isOpen={isConflictDialogOpen}
                    onClose={() => setConflictDialogOpen(false)}
                    onResolve={handleResolveConflict}
                    cloudPlan={userData?.nutritionPlanning || null}
                    localPlan={pendingConflict}
                    isSyncing={isResolving}
                />
            )}
        </div>
    );
};

export default NutritionView;
