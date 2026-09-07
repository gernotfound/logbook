import { getDb } from '../firebase';
import { doc, getDoc } from 'firebase/firestore';
import deepEqual from 'fast-deep-equal';
import { removeUndefinedValues } from '../utils/object';
import { checkDocSize } from '../checkDocSize';
import { wrapInFirestoreDocument } from '../firestore-rest';
import { withTimeout } from './db_core';

export async function loadNutritionMonths(user: any, targetMonths: string[], state: any) {
    const nutritionDocs = await withTimeout(
        Promise.all(targetMonths.map(m => getDoc(doc(getDb(), "users", user.uid, "nutrition_months", m)))),
        6000,
        "Timeout recupero nutrizione"
    );
    nutritionDocs.forEach(d => {
        if (d && typeof d.exists === 'function' && d.exists()) {
            const monthData = d.data() as Record<string, any>;
            if (monthData) {
                Object.keys(monthData).forEach((date: string) => {
                    (state.nutrition as any)[date] = monthData[date];
                });
            }
        }
    });
}

export function syncNutritionMonths(batch: any, user: any, state: any, oldState: any, restWrites: any[], projectId: string): boolean {
    let hasWrites = false;
    const newNutMonths: Record<string, any> = {};
    Object.keys(state.nutrition || {}).forEach(date => {
        const monthKey = date.substring(0, 7);
        if (!newNutMonths[monthKey]) newNutMonths[monthKey] = {};
        newNutMonths[monthKey][date] = state.nutrition[date];
    });

    const oldNutMonths: Record<string, any> = {};
    Object.keys(oldState.nutrition || {}).forEach(date => {
        const monthKey = date.substring(0, 7);
        if (!oldNutMonths[monthKey]) oldNutMonths[monthKey] = {};
        oldNutMonths[monthKey][date] = oldState.nutrition[date];
    });

    Object.keys(newNutMonths).forEach(month => {
        if (!deepEqual(newNutMonths[month], oldNutMonths[month])) {
            const cleanDoc = removeUndefinedValues(newNutMonths[month]);
            checkDocSize(cleanDoc, `Nutrition ${month}`);
            batch.set(doc(getDb(), "users", user.uid, "nutrition_months", month), cleanDoc);
            restWrites.push({
                update: {
                    name: `projects/${projectId}/databases/(default)/documents/users/${user.uid}/nutrition_months/${month}`,
                    ...wrapInFirestoreDocument(cleanDoc)
                }
            });
            hasWrites = true;
        }
    });
    Object.keys(oldNutMonths).forEach(month => {
        if (!newNutMonths[month]) {
            batch.delete(doc(getDb(), "users", user.uid, "nutrition_months", month));
            restWrites.push({
                delete: `projects/${projectId}/databases/(default)/documents/users/${user.uid}/nutrition_months/${month}`
            });
            hasWrites = true;
        }
    });
    return hasWrites;
}
