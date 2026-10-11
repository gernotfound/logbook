import { useAppStore } from '../store/useAppStore';
import { useDialogStore } from '../store/useDialogStore';
import { Logic } from '../lib/logic';
import { Supplement, SupplementIntake } from '../types';

const EMPTY_SUPPLEMENTS: Supplement[] = [];
const EMPTY_INTAKES: SupplementIntake[] = [];

export function useSupplements(dateStr?: string) {
    const targetDateStr = dateStr || Logic.getLocalDateString();

    const supplementsLibrary = useAppStore(state => state.userData?.supplements || EMPTY_SUPPLEMENTS);
    const todayNutrition = useAppStore(state => state.userData?.nutrition?.[targetDateStr]);
    const supplementsIntake = todayNutrition?.supplementsIntake || EMPTY_INTAKES;

    const dispatchDomainOperation = useAppStore(state => state.dispatchDomainOperation);
    const showAlert = useDialogStore(state => state.showAlert);
    const persistSupplement = async (operation: Parameters<typeof dispatchDomainOperation>[0]) => {
        const result = await persistSupplement(operation);
        if (!result.ok && result.status !== 'local-pending') {
            throw result.error instanceof Error ? result.error : new Error('Operazione integratore non completata');
        }
    };

    const saveSupplementToLibrary = async (supplement: Omit<Supplement, 'id'>, editId?: string) => {
        try {
            const value: Supplement = { ...supplement, id: editId || Logic.generateId('supp') };
            await persistSupplement({ type: 'supplement.upsert', supplement: value });
        } catch {
            void showAlert("Errore durante il salvataggio dell'integratore.");
        }
    };

    const deleteSupplementFromLibrary = async (id: string) => {
        try {
            await persistSupplement({ type: 'supplement.delete', id });
        } catch {
            void showAlert("Errore durante l'eliminazione dell'integratore.");
        }
    };

    const addIntake = async (supplementId: string, amount: number) => {
        try {
            const intake: SupplementIntake = {
                id: Logic.generateId('intake'),
                supplementId,
                amount,
                time: Date.now()
            };
            await persistSupplement({ type: 'supplement-intake.upsert', date: targetDateStr, intake });
        } catch {
            void showAlert("Errore durante l'aggiunta dell'assunzione.");
        }
    };

    const removeIntake = async (intakeId: string) => {
        try {
            await persistSupplement({ type: 'supplement-intake.delete', date: targetDateStr, intakeId });
        } catch {
            void showAlert("Errore durante la rimozione dell'assunzione.");
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
