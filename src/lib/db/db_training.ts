import { getDb } from '../firebase';
import { doc, getDoc } from 'firebase/firestore';
import { normalizeCloudDocument } from '../schemaEvolution';
import { withTimeout } from './db_core';
import { sanitizeHistoryMonthDocument } from '../sync/monthlyIntegrity';

export async function loadHistoryMonths(user: any, targetMonths: string[], state: any, cloudDocuments?: Map<string, any>) {
    const historyDocs = await withTimeout(
        Promise.all(targetMonths.map(m => getDoc(doc(getDb(), "users", user.uid, "history_months", m)))),
        6000,
        "Timeout recupero storico"
    );
    historyDocs.forEach((d, index) => {
        const month = targetMonths[index];
        if (d && typeof d.exists === 'function' && d.exists()) {
            const normalized = normalizeCloudDocument(d.data(), `History ${month} data schema`);
            const monthData = sanitizeHistoryMonthDocument(month, normalized.business);
            if (cloudDocuments) {
                cloudDocuments.set('history_months/' + month, { ...monthData, _sync: normalized.sync });
            }
            Object.values(monthData).forEach((h: any) => {
                state.history.push(h);
            });
        }
    });
}
