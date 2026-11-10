import type { CachedGlobalCatalog, UserData, WorkoutSession } from '../../../types';
import { getLocalDateString } from '../../utils/date';
import { projectDocuments } from '../documentProjection';
import {
    diffDocuments,
    type SemanticOperation,
    type VectorClock,
} from '../semanticProjection';
import type { DomainOperation, DomainOperationBatch } from './contracts';
import { normalizeDomainOperationBatch } from './reducer';
import { DATE_RE, requireDate, requireId, assertNeverDomainOperation } from './validation';

type Scope = {
    rootKeys: Set<string>;
    monthly: Map<string, Set<string>>;
};

function addMonthly(scope: Scope, path: string, entityId: string): void {
    const ids = scope.monthly.get(path) ?? new Set<string>();
    ids.add(entityId);
    scope.monthly.set(path, ids);
}

function workoutMonth(workout: WorkoutSession | undefined): string | null {
    if (!workout) return null;
    const date = workout.date || (workout.globalStartTime ? getLocalDateString(workout.globalStartTime) : '');
    return DATE_RE.test(date) ? date.slice(0, 7) : null;
}

function firstHistoryById(history: UserData['history']): Map<string, WorkoutSession> {
    const indexed = new Map<string, WorkoutSession>();
    for (const workout of history ?? []) {
        // Match Array.find(): the first occurrence is authoritative even for malformed inputs.
        if (typeof workout.id === 'string' && !indexed.has(workout.id)) indexed.set(workout.id, workout);
    }
    return indexed;
}

function collectScope(before: UserData, after: UserData, operations: readonly DomainOperation[]): Scope {
    const scope: Scope = { rootKeys: new Set(), monthly: new Map() };
    const root = (...keys: string[]) => keys.forEach(key => scope.rootKeys.add(key));
    const multipleHistoryEdits = operations.filter(operation => operation.type === 'history.upsert'
        || operation.type === 'history.delete' || operation.type === 'workout.complete').length > 1;
    const beforeById = multipleHistoryEdits ? firstHistoryById(before.history) : null;
    const afterById = multipleHistoryEdits ? firstHistoryById(after.history) : null;
    const previousWorkout = (id: string) => beforeById
        ? beforeById.get(id) : before.history?.find(workout => workout.id === id);
    const nextWorkout = (id: string) => afterById
        ? afterById.get(id) : after.history?.find(workout => workout.id === id);

    for (const operation of operations) {
        switch (operation.type) {
            case 'profile.patch': root('profile'); break;
            case 'nutrition-planning.replace': root('nutritionPlanning', 'nutritionPlanningOrigin'); break;
            case 'supplement.upsert':
            case 'supplement.delete':
            case 'supplement.reorder': root('supplements'); break;
            case 'routine.upsert':
            case 'routine.delete':
            case 'routine.reorder':
            case 'routine-exercise.upsert':
            case 'routine-exercise.delete':
            case 'routine-exercise.reorder': root('routines'); break;
            case 'training-cycle.upsert':
            case 'training-cycle.delete':
            case 'training-cycle.reorder':
            case 'training-cycle-routine.upsert':
            case 'training-cycle-routine.delete':
            case 'training-cycle-routine.reorder': root('trainingCycles'); break;
            case 'active-cycle.set': root('activeCycleId'); break;
            case 'active-workout.set': root('activeWorkout'); break;
            case 'active-pains.set': root('activePains'); break;
            case 'exercise.upsert': root('library', 'catalogOverrides'); break;
            case 'exercise.delete': root('library', 'catalogOverrides', 'routines'); break;
            case 'food.upsert':
            case 'food.delete': root('customFoods', 'catalogOverrides'); break;
            case 'catalog.exercise.patch':
            case 'catalog.food.patch':
            case 'catalog.exercise.visibility':
            case 'catalog.food.visibility': root('catalogOverrides'); break;
            case 'legal-consent.set': root('legalConsent'); break;
            case 'nutrition-day.patch':
            case 'nutrition-day.delete':
            case 'activity-steps.set':
            case 'activity-steps.clear':
            case 'cardio-session.upsert':
            case 'cardio-session.delete':
            case 'nutrition-meal.upsert':
            case 'nutrition-meal.delete':
            case 'supplement-intake.upsert':
            case 'supplement-intake.delete': {
                const date = requireDate(operation.date);
                addMonthly(scope, `nutrition_months/${date.slice(0, 7)}`, date);
                break;
            }
            case 'history.upsert': {
                const id = requireId(operation.workout.id, 'Allenamento');
                const old = previousWorkout(id);
                const next = nextWorkout(id);
                const oldMonth = workoutMonth(old);
                const newMonth = workoutMonth(next);
                if (oldMonth) addMonthly(scope, `history_months/${oldMonth}`, id);
                if (newMonth) addMonthly(scope, `history_months/${newMonth}`, id);
                break;
            }
            case 'history.delete': {
                const id = requireId(operation.id, 'Allenamento');
                const oldMonth = workoutMonth(previousWorkout(id));
                if (oldMonth) addMonthly(scope, `history_months/${oldMonth}`, id);
                break;
            }
            case 'workout.complete': {
                root('activeWorkout', 'activePains');
                const id = requireId(operation.workout.id, 'Allenamento');
                const old = previousWorkout(id);
                const next = nextWorkout(id);
                const oldMonth = workoutMonth(old);
                const newMonth = workoutMonth(next);
                if (oldMonth) addMonthly(scope, `history_months/${oldMonth}`, id);
                if (newMonth) addMonthly(scope, `history_months/${newMonth}`, id);
                break;
            }
            default: assertNeverDomainOperation(operation);
        }
    }

    return scope;
}

export function compileDomainOperations(
    before: UserData,
    after: UserData,
    batch: DomainOperationBatch,
    catalog: CachedGlobalCatalog,
    actorId: string,
    seq: number,
    clock: VectorClock,
): SemanticOperation[] {
    const operations = normalizeDomainOperationBatch(batch);
    const scope = collectScope(before, after, operations);
    const baseDocuments = projectDocuments(before, catalog, scope);
    const desiredDocuments = projectDocuments(after, catalog, scope);
    return diffDocuments(baseDocuments, desiredDocuments, actorId, seq, clock);
}