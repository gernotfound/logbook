import type { Supplement, SupplementIntake } from '../../types';
import type { DomainOperation } from '../sync/domainOperations';
import { generateId } from '../utils/date';

export const EMPTY_SUPPLEMENTS: Supplement[] = [];
export const EMPTY_INTAKES: SupplementIntake[] = [];

export function createSupplementActions(date: string, {
    capture, dispatch, showAlert,
}: {
    capture: () => { isCurrent: () => boolean } | null;
    dispatch: (operation: DomainOperation) => Promise<void>;
    showAlert: (message: string) => Promise<unknown>;
}) {
    const remove = async (operation: DomainOperation, message: string) => {
        const session = capture();
        if (!session?.isCurrent()) return;
        try {
            await dispatch(operation);
        } catch {
            if (session.isCurrent()) void showAlert(message);
        }
    };

    return {
        saveSupplementToLibrary(supplement: Omit<Supplement, 'id'>, editId?: string) {
            return dispatch({
                type: editId ? 'supplement.edit' : 'supplement.upsert',
                supplement: { ...supplement, id: editId || generateId('supp') },
            });
        },
        deleteSupplementFromLibrary(id: string) {
            return remove({ type: 'supplement.delete', id }, "Errore durante l'eliminazione dell'integratore.");
        },
        addIntake(supplementId: string, amount: number) {
            return dispatch({
                type: 'supplement-intake.add', date,
                intake: { id: generateId('intake'), supplementId, amount, time: Date.now() },
            });
        },
        removeIntake(intakeId: string) {
            return remove({ type: 'supplement-intake.delete', date, intakeId }, "Errore durante la rimozione dell'assunzione.");
        },
    };
}
