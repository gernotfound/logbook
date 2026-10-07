import { getDb } from '../firebase';
import { doc, getDoc } from 'firebase/firestore';
import { normalizeCloudDocument } from '../schemaEvolution';
import { withTimeout } from './db_core';
import { sanitizeNutritionMonthDocument } from '../sync/monthlyIntegrity';

export async function loadNutritionMonths(user: any, targetMonths: string[], state: any, cloudDocuments?: Map<string, any>) {
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
                (state.nutrition as any)[date] = day;
            });
        }
    });
}
