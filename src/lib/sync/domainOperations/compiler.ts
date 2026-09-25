import type { CachedGlobalCatalog, UserData, WorkoutSession } from '../../../types';
import { getLocalDateString } from '../../utils/date';
import { projectDocuments, type DocumentData } from '../documentProjection';
import {
    diffDocuments,
    type SemanticOperation,
    type VectorClock,
} from '../semanticProjection';
import type { DomainOperation, DomainOperationBatch } from './contracts';
import { normalizeDomainOperationBatch } from './reducer';
import { DATE_RE, requireDate, requireId } from './validation';

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

function collectScope(before: UserData, after: UserData, operations: readonly DomainOperation[]): Scope {
    const scope: Scope = { rootKeys: new Set(), monthly: new Map() };
    const root = (...keys: string[]) => keys.forEach(key => scope.rootKeys.add(key));

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
            case 'exercise.upsert':
            case 'exercise.delete': root('library', 'catalogOverrides'); break;
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
            case 'context-event.upsert':
            case 'context-event.delete':
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
                const old = before.history?.find(item => item.id === id);
                const next = after.history?.find(item => item.id === id);
                const oldMonth = workoutMonth(old);
                const newMonth = workoutMonth(next);
                if (oldMonth) addMonthly(scope, `history_months/${oldMonth}`, id);
                if (newMonth) addMonthly(scope, `history_months/${newMonth}`, id);
                break;
            }
            case 'history.delete': {
                const id = requireId(operation.id, 'Allenamento');
                const oldMonth = workoutMonth(before.history?.find(item => item.id === id));
                if (oldMonth) addMonthly(scope, `history_months/${oldMonth}`, id);
                break;
            }
            case 'workout.complete': {
                root('activeWorkout', 'activePains');
                const id = requireId(operation.workout.id, 'Allenamento');
                const old = before.history?.find(item => item.id === id);
                const next = after.history?.find(item => item.id === id);
                const oldMonth = workoutMonth(old);
                const newMonth = workoutMonth(next);
                if (oldMonth) addMonthly(scope, `history_months/${oldMonth}`, id);
                if (newMonth) addMonthly(scope, `history_months/${newMonth}`, id);
                break;
            }
        }
    }

    return scope;
}

function pickDocument(source: DocumentData, keys: Iterable<string>): DocumentData {
    const result: DocumentData = {};
    for (const key of keys) {
        if (Object.hasOwn(source, key)) result[key] = source[key];
    }
    return result;
}

function projectScoped(data: UserData, catalog: CachedGlobalCatalog, scope: Scope): Map<string, DocumentData> {
    const full = projectDocuments(data, catalog);
    const scoped = new Map<string, DocumentData>();

    if (scope.rootKeys.size) scoped.set('', pickDocument(full.get('') ?? {}, scope.rootKeys));
    for (const [path, ids] of scope.monthly.entries()) {
        scoped.set(path, pickDocument(full.get(path) ?? {}, ids));
    }
    return scoped;
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
    const baseDocuments = projectScoped(before, catalog, scope);
    const desiredDocuments = projectScoped(after, catalog, scope);
    return diffDocuments(baseDocuments, desiredDocuments, actorId, seq, clock);
}
