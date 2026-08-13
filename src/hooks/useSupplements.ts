import { useAppStore } from '../store/useAppStore';
import { useDialogStore } from '../store/useDialogStore';
import { Logic } from '../lib/logic';
import { Supplement, SupplementIntake } from '../types';

const EMPTY_SUPPLEMENTS: Supplement[] = [];
const EMPTY_INTAKES: SupplementIntake[] = [];

export function useSupplements(dateStr?: string) {
    const targetDateStr = dateStr || Logic.getLocalDateString();
    
    // Get library from userData
    const supplementsLibrary = useAppStore(state => state.userData?.supplements || EMPTY_SUPPLEMENTS);
    
    // Get today's intake
    const todayNutrition = useAppStore(state => state.userData?.nutrition?.[targetDateStr]);
    const supplementsIntake = todayNutrition?.supplementsIntake || EMPTY_INTAKES;
    
    const saveUserData = useAppStore(state => state.saveUserData);
    const showAlert = useDialogStore(state => state.showAlert);

    const saveSupplementToLibrary = async (supplement: Omit<Supplement, 'id'>, editId?: string) => {
        try {
            await saveUserData((prev) => {
                if (!prev) return prev;
                const currentLibrary = prev.supplements || [];
                let updatedLibrary;
                
                if (editId) {
                    updatedLibrary = currentLibrary.map(s => s.id === editId ? { ...supplement, id: editId } : s);
                } else {
                    const newSupplement: Supplement = {
                        ...supplement,
                        id: Logic.generateId('supp')
                    };
                    updatedLibrary = [...currentLibrary, newSupplement];
                }
                
                return { ...prev, supplements: updatedLibrary };
            });
        } catch {
            showAlert("Errore durante il salvataggio dell'integratore.");
        }
    };
    
    const deleteSupplementFromLibrary = async (id: string) => {
        try {
            await saveUserData((prev) => {
                if (!prev) return prev;
                const currentLibrary = prev.supplements || [];
                const updatedLibrary = currentLibrary.filter(s => s.id !== id);
                return { ...prev, supplements: updatedLibrary };
            });
        } catch {
            showAlert("Errore durante l'eliminazione dell'integratore.");
        }
    };

    const addIntake = async (supplementId: string, amount: number) => {
        try {
            await saveUserData((prev) => {
                if (!prev) return prev;
                const todayData = prev.nutrition?.[targetDateStr] || { date: targetDateStr, kcal: 0, carbs: 0, pro: 0, fat: 0 };
                const currentIntakes = todayData.supplementsIntake || [];
                
                const newIntake: SupplementIntake = {
                    id: Logic.generateId('intake'),
                    supplementId,
                    amount,
                    time: Date.now()
                };
                
                const updatedIntakes = [...currentIntakes, newIntake];
                return { 
                    ...prev, 
                    nutrition: { 
                        ...(prev.nutrition || {}), 
                        [targetDateStr]: { ...todayData, supplementsIntake: updatedIntakes } 
                    } 
                };
            });
        } catch {
            showAlert("Errore durante l'aggiunta dell'assunzione.");
        }
    };

    const removeIntake = async (intakeId: string) => {
        try {
            await saveUserData((prev) => {
                if (!prev) return prev;
                const todayData = prev.nutrition?.[targetDateStr];
                if (!todayData) return prev;
                
                const currentIntakes = todayData.supplementsIntake || [];
                const updatedIntakes = currentIntakes.filter(i => i.id !== intakeId);
                
                return { 
                    ...prev, 
                    nutrition: { 
                        ...(prev.nutrition || {}), 
                        [targetDateStr]: { ...todayData, supplementsIntake: updatedIntakes } 
                    } 
                };
            });
        } catch {
            showAlert("Errore durante la rimozione dell'assunzione.");
        }
    };

    return {
        targetDateStr,
        supplementsLibrary,
        supplementsIntake,
        saveSupplementToLibrary,
        deleteSupplementFromLibrary,
        addIntake,
        removeIntake
    };
}
