import equal from 'fast-deep-equal';
import { UserDataSchema } from '../schema';
import type { UserData, CachedGlobalCatalog } from '../../types';
import { extractCustomExercisesAndOverrides, extractCustomFoodsAndOverrides, resolveEffectiveExercises, resolveEffectiveFoods } from '../catalog/deltaResolver';
import { getLocalDateString } from '../utils/date';
import { removeUndefinedValues } from '../utils/object';

export type DocumentData = Record<string, unknown>;
export interface DocumentChange { path: string; base: DocumentData; desired: DocumentData }
const monthPattern = /^\d{4}-(0[1-9]|1[0-2])$/;
const rootKeys = ['profile', 'library', 'routines', 'customFoods', 'activeWorkout', 'trainingCycles', 'activeCycleId', 'nutritionPlanning', 'supplements', 'activePains', 'catalogOverrides', 'legalConsent', 'nutritionPlanningOrigin'] as const;

export function rootDocument(data: UserData): DocumentData {
    return removeUndefinedValues(Object.fromEntries(rootKeys.map(key => [key, data[key] ?? null]))) as DocumentData;
}

export function projectDocuments(input: UserData, catalog: CachedGlobalCatalog): Map<string, DocumentData> {
    const data = UserDataSchema.parse(input) as unknown as UserData;
    const exercises = extractCustomExercisesAndOverrides(data.library, catalog.exercises);
    const foods = extractCustomFoodsAndOverrides(data.customFoods, catalog.foods);
    // Recompute visible catalog overrides: a restored default must not inherit a stale override.
    const exerciseOverrides = { ...data.catalogOverrides?.exercises };
    const foodOverrides = { ...data.catalogOverrides?.foods };
    for (const item of catalog.exercises) if ((data.library ?? []).some(ex => ex.id === item.id)) delete exerciseOverrides[item.id];
    for (const item of catalog.foods) if ((data.customFoods ?? []).some(food => String(food.id) === String(item.id))) delete foodOverrides[String(item.id)];
    const visibleExercises = new Set((data.library ?? []).map(ex => ex.id));
    const visibleFoods = new Set((data.customFoods ?? []).map(food => String(food.id)));
    const root = rootDocument({ ...data, library: exercises.customExercises, customFoods: foods.customFoods, catalogOverrides: {
        exercises: { ...exerciseOverrides, ...exercises.overrides.exercises },
        foods: { ...foodOverrides, ...foods.overrides.foods },
        hiddenExerciseIds: [...new Set([...(data.catalogOverrides?.hiddenExerciseIds ?? []).filter(id => !visibleExercises.has(id)), ...(exercises.overrides.hiddenExerciseIds ?? [])])],
        hiddenFoodIds: [...new Set([...(data.catalogOverrides?.hiddenFoodIds ?? []).map(String).filter(id => !visibleFoods.has(id)), ...(foods.overrides.hiddenFoodIds ?? [])])],
    } });
    const documents = new Map<string, DocumentData>([['', root]]);
    const add = (collection: string, month: string, id: string, value: unknown) => {
        if (!monthPattern.test(month) || !id || id.includes('/')) throw new Error('Data o identificativo non valido: operazione conservata localmente');
        const path = `${collection}/${month}`;
        const document = documents.get(path) ?? {};
        if (Object.hasOwn(document, id)) throw new Error(`Identificativo duplicato nello storico: ${id}`);
        Object.defineProperty(document, id, { value: removeUndefinedValues(value), enumerable: true, configurable: true, writable: true });
        documents.set(path, document);
    };
    for (const workout of (data.history ?? [])) {
        const date = workout.date || (workout.globalStartTime ? getLocalDateString(workout.globalStartTime) : getLocalDateString());
        add('history_months', date.slice(0, 7), String(workout.id ?? ''), workout);
    }
    for (const [date, day] of Object.entries(data.nutrition ?? {})) {
        if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || getLocalDateString(new Date(`${date}T12:00:00`)) !== date) throw new Error('Data nutrizione non valida');
        add('nutrition_months', date.slice(0, 7), date, day);
    }
    return documents;
}

export function documentChanges(base: UserData, desired: UserData, catalog: CachedGlobalCatalog): DocumentChange[] {
    const before = projectDocuments(base, catalog);
    const after = projectDocuments(desired, catalog);
    return [...new Set([...before.keys(), ...after.keys()])].flatMap(path => {
        const original = before.get(path) ?? {};
        const next = after.get(path) ?? {};
        return equal(original, next) ? [] : [{ path, base: original, desired: next }];
    });
}

export function applyRemoteDocuments(local: UserData, documents: Map<string, DocumentData>, catalog: CachedGlobalCatalog): UserData {
    let next = { ...local };
    const root = documents.get('');
    if (root) {
        const parsed = UserDataSchema.parse(root) as unknown as UserData;
        next = { ...next, ...root,
            library: resolveEffectiveExercises(catalog.exercises, parsed.library, parsed.catalogOverrides),
            customFoods: resolveEffectiveFoods(catalog.foods, parsed.customFoods, parsed.catalogOverrides),
        } as UserData;
    }
    for (const [path, data] of documents) {
        const [collection, month] = path.split('/');
        if (collection === 'history_months') {
            const preserved = (next.history ?? []).filter(workout => (workout.date || (workout.globalStartTime ? getLocalDateString(workout.globalStartTime) : '')).slice(0, 7) !== month);
            next.history = [...preserved, ...Object.values(data)] as UserData['history'];
        } else if (collection === 'nutrition_months') {
            next.nutrition = { ...Object.fromEntries(Object.entries(next.nutrition ?? {}).filter(([date]) => date.slice(0, 7) !== month)), ...data } as UserData['nutrition'];
        }
    }
    return UserDataSchema.parse(next) as unknown as UserData;
}
