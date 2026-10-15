import { getDb } from '../firebase';
import { doc, getDoc } from 'firebase/firestore';
import { normalizeCloudDocument } from '../schemaEvolution';
import { withTimeout } from './db_core';
import { requireCompleteNutritionMonthDocument } from '../sync/monthlyIntegrity';

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
    // Validate the entire requested window before publishing any day or
    // causal metadata. A damaged later shard cannot leak a partial window.
    const staged = nutritionDocs.flatMap((d, index) => {
        const month = targetMonths[index];
        if (!d || typeof d.exists !== 'function' || !d.exists()) return [];
        const normalized = normalizeCloudDocument(d.data(), `Nutrition ${month} data schema`);
        const business = requireCompleteNutritionMonthDocument(month, normalized.business);
        return [{ month, business, sync: normalized.sync }];
    });
    for (const { month, business, sync } of staged) {
        if (cloudDocuments) cloudDocuments.set('nutrition_months/' + month, { ...business, _sync: sync });
        Object.assign(state.nutrition, business);
    }
}
