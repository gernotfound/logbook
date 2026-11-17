import type { SyncResult } from '../../types';
import type { DomainOperationBatch } from './domainOperations';

/**
 * Completion of a Promise is not proof of durable storage. Only 'synced' or
 * journal-verified 'local-pending' may release an unsaved form/draft.
 */
export async function dispatchDurableOperation(
    dispatch: (operation: DomainOperationBatch) => Promise<SyncResult>,
    operation: DomainOperationBatch,
): Promise<void> {
    const result = await dispatch(operation);
    if (!result.ok && result.status !== 'local-pending') {
        throw result.error instanceof Error
            ? result.error
            : new Error('Salvataggio sul dispositivo non confermato');
    }
}
