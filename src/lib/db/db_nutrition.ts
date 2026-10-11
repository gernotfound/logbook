import { getDb } from '../firebase';
import { doc, getDoc } from 'firebase/firestore';
import { normalizeCloudDocument } from '../schemaEvolution';
import { withTimeout } from './db_core';
import { sanitizeNutritionMonthDocument } from '../sync/monthlyIntegrity';

// Keep data untrusted until the caller's final business schema gateway.
export async function loadNutritionMonths(
    user: { readonly uid: string },
    targetMonths: readonly string[],
    state: { nutrition: Record<string, unknown> },
    cloudDocuments?: Map<string, Record<string, unknown>>,
): Promise<void> {
    const nutritionDocs = await withTimeout(
        Promise.all(targetMonths.map(m => getDoc(doc(getDb(), "users", user.uid, "nutrition_months", m)))),
        6000,
        "Timeout recupero nutrizione"
    );
    nutritionDocs.forEach((d, index) => {
        const month = targetMonths[index];
        if (d && typeof d.exists === 'function' && d.exists()) {
            const normalized = normalizeCloudDocument(d.data(), `Nutrition ${month} data schema`);
            const monthData = sanitizeNutritionMonthDocument(month, normalized.business);
            if (cloudDocuments) {
                cloudDocuments.set('nutrition_months/' + month, { ...monthData, _sync: normalized.sync });
            }
            Object.entries(monthData).forEach(([date, day]) => {
                state.nutrition[date] = day;
            });
        }
    });
}
