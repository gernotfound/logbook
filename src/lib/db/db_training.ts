import { getDb } from '../firebase';
import { doc, getDoc } from 'firebase/firestore';
import deepEqual from 'fast-deep-equal';
import { getLocalDateString } from '../utils/date';
import { removeUndefinedValues } from '../utils/object';
import { checkDocSize } from '../checkDocSize';
import { wrapInFirestoreDocument } from '../firestore-rest';
import { withTimeout } from './db_core';

export async function loadHistoryMonths(user: any, targetMonths: string[], state: any, cloudDocuments?: Map<string, any>) {
    const historyDocs = await withTimeout(
        Promise.all(targetMonths.map(m => getDoc(doc(getDb(), "users", user.uid, "history_months", m)))),
        6000,
        "Timeout recupero storico"
    );
    historyDocs.forEach(d => {
        if (d && typeof d.exists === 'function' && d.exists()) {
            const monthData = d.data() as Record<string, any>;
            if (monthData) {
                if (monthData._sync && cloudDocuments) {
                    cloudDocuments.set('history_months/' + d.id, monthData);
                }
                Object.entries(monthData).forEach(([key, h]: [string, any]) => {
                    if (key !== '_sync') {
                        state.history.push(h);
                    }
                });
            }
        }
    });
}

export function syncHistoryMonths(batch: any, user: any, state: any, oldState: any, restWrites: any[], projectId: string): boolean {
    let hasWrites = false;
    const newHistMonths: Record<string, any> = {};
    state.history.forEach((h: any) => {
        const monthKey = (h.date && typeof h.date === 'string' && h.date.length >= 7)
            ? h.date.substring(0, 7)
            : (h.globalStartTime ? getLocalDateString(h.globalStartTime).substring(0, 7) : getLocalDateString().substring(0, 7));
        if (!newHistMonths[monthKey]) newHistMonths[monthKey] = {};
        newHistMonths[monthKey][h.id] = h;
    });

    const oldHistMonths: Record<string, any> = {};
    (oldState.history || []).forEach((h: any) => {
        const monthKey = (h.date && typeof h.date === 'string' && h.date.length >= 7)
            ? h.date.substring(0, 7)
            : (h.globalStartTime ? getLocalDateString(h.globalStartTime).substring(0, 7) : getLocalDateString().substring(0, 7));
        if (!oldHistMonths[monthKey]) oldHistMonths[monthKey] = {};
        oldHistMonths[monthKey][h.id] = h;
    });

    Object.keys(newHistMonths).forEach(month => {
        if (!deepEqual(newHistMonths[month], oldHistMonths[month])) {
            const cleanDoc = removeUndefinedValues(newHistMonths[month]);
            checkDocSize(cleanDoc, `History ${month}`);
            batch.set(doc(getDb(), "users", user.uid, "history_months", month), cleanDoc);
            restWrites.push({
                update: {
                    name: `projects/${projectId}/databases/(default)/documents/users/${user.uid}/history_months/${month}`,
                    ...wrapInFirestoreDocument(cleanDoc)
                }
            });
            hasWrites = true;
        }
    });
    Object.keys(oldHistMonths).forEach(month => {
        if (!newHistMonths[month]) {
            batch.delete(doc(getDb(), "users", user.uid, "history_months", month));
            restWrites.push({
                delete: `projects/${projectId}/databases/(default)/documents/users/${user.uid}/history_months/${month}`
            });
            hasWrites = true;
        }
    });
    return hasWrites;
}
