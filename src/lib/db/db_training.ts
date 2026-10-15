import { getDb } from '../firebase';
import { doc, getDoc } from 'firebase/firestore';
import { normalizeCloudDocument } from '../schemaEvolution';
import { withTimeout } from './db_core';
import { requireCompleteHistoryMonthDocument } from '../sync/monthlyIntegrity';

// Monthly snapshots are untrusted until the final DomainParsers gateway runs.
export async function loadHistoryMonths(
    user: { readonly uid: string },
    targetMonths: readonly string[],
    state: { history: unknown[] },
    cloudDocuments?: Map<string, Record<string, unknown>>,
): Promise<void> {
    const historyDocs = await withTimeout(
        Promise.all(targetMonths.map(m => getDoc(doc(getDb(), "users", user.uid, "history_months", m)))),
        6000,
        "Timeout recupero storico"
    );
    historyDocs.forEach((d, index) => {
        const month = targetMonths[index];
        if (d && typeof d.exists === 'function' && d.exists()) {
            const normalized = normalizeCloudDocument(d.data(), `History ${month} data schema`);
            const monthData = requireCompleteHistoryMonthDocument(month, normalized.business);
            if (cloudDocuments) {
                cloudDocuments.set('history_months/' + month, { ...monthData, _sync: normalized.sync });
            }
            Object.values(monthData).forEach(h => {
                state.history.push(h);
            });
        }
    });
}
