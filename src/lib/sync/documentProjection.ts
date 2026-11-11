import { UserDataSchema } from '../schema';
import type { UserData, CachedGlobalCatalog, WorkoutSession } from '../../types';
import { extractCustomExercisesAndOverrides, extractCustomFoodsAndOverrides, resolveEffectiveExercises, resolveEffectiveFoods } from '../catalog/deltaResolver';
import { getLocalDateString } from '../utils/date';
import { requireCanonicalWorkoutDate, sanitizeHistoryMonthDocument, sanitizeNutritionMonthDocument } from './monthlyIntegrity';
import { removeUndefinedValuesForFirestore } from '../utils/object';

export type DocumentData = Record<string, unknown>;

export type DocumentProjectionScope = {
    rootKeys: ReadonlySet<string>;
    monthly: ReadonlyMap<string, ReadonlySet<string>>;
};
const monthPattern = /^\d{4}-(0[1-9]|1[0-2])$/;
const rootKeys = ['profile', 'library', 'routines', 'customFoods', 'activeWorkout', 'trainingCycles', 'activeCycleId', 'nutritionPlanning', 'supplements', 'activePains', 'catalogOverrides', 'legalConsent', 'nutritionPlanningOrigin'] as const;

export function rootDocument(data: UserData): DocumentData {
    return removeUndefinedValuesForFirestore(Object.fromEntries(rootKeys.map(key => [key, data[key] ?? null]))) as DocumentData;
}

export function projectDocuments(input: UserData, catalog: CachedGlobalCatalog, scope?: DocumentProjectionScope): Map<string, DocumentData> {
    return projectUserDocuments(UserDataSchema.parse(input) as unknown as UserData, catalog, scope);
}

// Only the Domain Operations compiler may skip redundant whole-archive parsing:
// its before-state has passed the local envelope gateway, and its after-state
// comes from the Zod-validating reducer. Untrusted cloud/backup/snapshot callers
// must continue through projectDocuments() and the independent lossless guards.
export function projectValidatedDomainDocuments(data: UserData, catalog: CachedGlobalCatalog, scope: DocumentProjectionScope): Map<string, DocumentData> {
    return projectUserDocuments(data, catalog, scope);
}

function projectUserDocuments(data: UserData, catalog: CachedGlobalCatalog, scope?: DocumentProjectionScope): Map<string, DocumentData> {
    const documents = new Map<string, DocumentData>();
    if (!scope || scope.rootKeys.size) {
        let projected = data;
        if (!scope || ['library', 'customFoods', 'catalogOverrides'].some(key => scope.rootKeys.has(key))) {
            const exercises = extractCustomExercisesAndOverrides(data.library, catalog.exercises);
            const foods = extractCustomFoodsAndOverrides(data.customFoods, catalog.foods);
            const visibleExercises = new Set((data.library ?? []).map(ex => ex.id));
            const visibleFoods = new Set((data.customFoods ?? []).map(food => String(food.id)));
            const exerciseOverrides = { ...data.catalogOverrides?.exercises };
            const foodOverrides = { ...data.catalogOverrides?.foods };
            // A restored default must not inherit stale overrides.
            for (const item of catalog.exercises) if (visibleExercises.has(item.id)) delete exerciseOverrides[item.id];
            for (const item of catalog.foods) if (visibleFoods.has(String(item.id))) delete foodOverrides[String(item.id)];
            projected = { ...data, library: exercises.customExercises, customFoods: foods.customFoods, catalogOverrides: {
                exercises: { ...exerciseOverrides, ...exercises.overrides.exercises },
                foods: { ...foodOverrides, ...foods.overrides.foods },
                hiddenExerciseIds: [...new Set([...(data.catalogOverrides?.hiddenExerciseIds ?? []).filter(id => !visibleExercises.has(id)), ...(exercises.overrides.hiddenExerciseIds ?? [])])],
                hiddenFoodIds: [...new Set([...(data.catalogOverrides?.hiddenFoodIds ?? []).map(String).filter(id => !visibleFoods.has(id)), ...(foods.overrides.hiddenFoodIds ?? [])])],
            } };
        }
        // Do not recursively sanitize unrelated root collections on a scoped mutation.
        const root = scope
            ? removeUndefinedValuesForFirestore(Object.fromEntries([...scope.rootKeys]
                .map(key => [key, projected[key as keyof UserData] ?? null]))) as DocumentData
            : rootDocument(projected);
        documents.set('', root);
    }

    const add = (collection: string, month: string, id: string, value: unknown) => {
        if (!monthPattern.test(month) || !id || id.includes('/')) throw new Error('Data o identificativo non valido: operazione conservata localmente');
        const path = `${collection}/${month}`;
        const document = documents.get(path) ?? {};
        if (Object.hasOwn(document, id)) throw new Error(`Identificativo duplicato nello storico: ${id}`);
        Object.defineProperty(document, id, { value: removeUndefinedValuesForFirestore(value), enumerable: true, configurable: true, writable: true });
        documents.set(path, document);
    };

    if (!scope) {
        for (const workout of data.history ?? []) {
            const date = requireCanonicalWorkoutDate(workout);
            add('history_months', date.slice(0, 7), String(workout.id ?? ''), workout);
        }
        for (const [date, day] of Object.entries(data.nutrition ?? {})) {
            if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || getLocalDateString(new Date(`${date}T12:00:00`)) !== date || day.date !== date) {
                throw new Error('Data nutrizione non valida o incoerente con la chiave');
            }
            add('nutrition_months', date.slice(0, 7), date, day);
        }
        return documents;
    }

    // Scope by entity ID rather than building and then discarding all monthly
    // documents. Keep both months of a moved workout in the causal diff.
    const requestedHistoryIds = new Set<string>();
    for (const [path, ids] of scope.monthly) {
        const [collection, month, extra] = path.split('/');
        if (extra || !monthPattern.test(month) || (collection !== 'history_months' && collection !== 'nutrition_months')) {
            throw new Error('Scope mensile non valido');
        }
        documents.set(path, {});
        if (collection === 'history_months') for (const id of ids) requestedHistoryIds.add(id);
    }
    const selectedHistory = new Map<string, WorkoutSession[]>();
    if (requestedHistoryIds.size > 0) {
        for (const workout of data.history ?? []) {
            const id = String(workout.id ?? '');
            if (!requestedHistoryIds.has(id)) continue;
            const selected = selectedHistory.get(id) ?? [];
            selected.push(workout);
            selectedHistory.set(id, selected);
        }
    }
    for (const [path, ids] of scope.monthly) {
        const [collection, month] = path.split('/');
        for (const id of ids) {
            if (collection === 'history_months') {
                for (const workout of selectedHistory.get(id) ?? []) {
                    const date = requireCanonicalWorkoutDate(workout);
                    if (date.slice(0, 7) === month) add(collection, month, id, workout);
                }
            } else if (Object.hasOwn(data.nutrition ?? {}, id)) {
                const day = data.nutrition![id];
                if (!/^\d{4}-\d{2}-\d{2}$/.test(id) || getLocalDateString(new Date(`${id}T12:00:00`)) !== id || day.date !== id) {
                    throw new Error('Data nutrizione non valida o incoerente con la chiave');
                }
                if (id.slice(0, 7) === month) add(collection, month, id, day);
            }
        }
    }
    return documents;
}

export function applyRemoteDocuments(local: UserData, documents: Map<string, DocumentData>, catalog: CachedGlobalCatalog): UserData {
    let next = { ...local };
    const root = documents.get('');
    if (root) {
        const parsed = UserDataSchema.parse(root) as unknown as UserData;
        next = { ...next, ...root,
            activeWorkout: parsed.activeWorkout,
            library: resolveEffectiveExercises(catalog.exercises, parsed.library, parsed.catalogOverrides),
            customFoods: resolveEffectiveFoods(catalog.foods, parsed.customFoods, parsed.catalogOverrides),
        } as UserData;
    }
    const replacedHistoryMonths = new Set<string>();
    const replacedNutritionMonths = new Set<string>();
    const incomingHistory: NonNullable<UserData['history']> = [];
    const incomingNutrition: NonNullable<UserData['nutrition']> = {};
    for (const [path, data] of documents) {
        const [collection, month] = path.split('/');
        if (collection === 'history_months') {
            const sanitized = sanitizeHistoryMonthDocument(month, data);
            replacedHistoryMonths.add(month);
            incomingHistory.push(...Object.values(sanitized) as NonNullable<UserData['history']>);
        } else if (collection === 'nutrition_months') {
            const sanitized = sanitizeNutritionMonthDocument(month, data);
            replacedNutritionMonths.add(month);
            Object.assign(incomingNutrition, sanitized);
        }
    }
    // Apply all monthly replacements together: retaining the original order of
    // untouched records and the document traversal order of incoming records.
    // This avoids a full history scan and nutrition copy for every cloud month.
    if (replacedHistoryMonths.size) {
        const preserved = (next.history ?? []).filter(workout => {
            try { return !replacedHistoryMonths.has(requireCanonicalWorkoutDate(workout).slice(0, 7)); }
            catch { return true; }
        });
        next.history = [...preserved, ...incomingHistory];
    }
    if (replacedNutritionMonths.size) {
        next.nutrition = {
            ...Object.fromEntries(Object.entries(next.nutrition ?? {})
                .filter(([date]) => !replacedNutritionMonths.has(date.slice(0, 7)))),
            ...incomingNutrition,
        };
    }
    return UserDataSchema.parse(next) as unknown as UserData;
}
