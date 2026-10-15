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
    // Stage every month before publication: a later corrupt shard must not
    // leave an earlier month partially installed in the hydration state.
    const staged = historyDocs.flatMap((d, index) => {
        const month = targetMonths[index];
        if (!d || typeof d.exists !== 'function' || !d.exists()) return [];
        const normalized = normalizeCloudDocument(d.data(), `History ${month} data schema`);
        const business = requireCompleteHistoryMonthDocument(month, normalized.business);
        return [{ month, business, sync: normalized.sync }];
    });
    for (const { month, business, sync } of staged) {
        if (cloudDocuments) cloudDocuments.set('history_months/' + month, { ...business, _sync: sync });
        state.history.push(...Object.values(business));
    }
}
