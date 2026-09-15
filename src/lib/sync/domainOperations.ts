import type {
    CachedGlobalCatalog,
    Exercise,
    Food,
    FoodOverride,
    ExerciseOverride,
    LegalConsent,
    LoggedMealItem,
    NutritionDay,
    NutritionPlanning,
    RoutineExercise,
    Supplement,
    SupplementIntake,
    TrainingCycle,
    TrainingCycleRoutineItem,
    UserData,
    UserProfile,
    WorkoutRoutine,
    WorkoutSession,
} from '../../types';
import { UserDataSchema } from '../schema';
import { calculateLoggedMealTotals } from '../nutrition/calculateLoggedMealTotals';
import { getLocalDateString } from '../utils/date';
import { projectDocuments, type DocumentData } from './documentProjection';
import {
    diffDocuments,
    type SemanticOperation,
    type VectorClock,
} from './semanticProjection';

export type NutritionDayPatch = Partial<Omit<
    NutritionDay,
    'date' | 'kcal' | 'carbs' | 'pro' | 'fat' | 'meals' | 'supplementsIntake'
>>;

export type DomainOperation =
    | { type: 'profile.patch'; patch: Partial<UserProfile> }
    | { type: 'nutrition-planning.replace'; value: NutritionPlanning; origin?: 'generated-default' | 'user-edited' }
    | { type: 'nutrition-day.patch'; date: string; patch: NutritionDayPatch }
    | { type: 'nutrition-day.delete'; date: string }
    | { type: 'nutrition-meal.upsert'; date: string; meal: LoggedMealItem }
    | { type: 'nutrition-meal.delete'; date: string; mealId: string }
    | { type: 'supplement-intake.upsert'; date: string; intake: SupplementIntake }
    | { type: 'supplement-intake.delete'; date: string; intakeId: string }
    | { type: 'supplement.upsert'; supplement: Supplement }
    | { type: 'supplement.delete'; id: string }
    | { type: 'supplement.reorder'; ids: string[] }
    | { type: 'routine.upsert'; routine: WorkoutRoutine }
    | { type: 'routine.delete'; id: string }
    | { type: 'routine.reorder'; ids: string[] }
    | { type: 'routine-exercise.upsert'; routineId: string; exercise: RoutineExercise }
    | { type: 'routine-exercise.delete'; routineId: string; exId: string }
    | { type: 'routine-exercise.reorder'; routineId: string; exIds: string[] }
    | { type: 'training-cycle.upsert'; cycle: TrainingCycle }
    | { type: 'training-cycle.delete'; id: string }
    | { type: 'training-cycle.reorder'; ids: string[] }
    | { type: 'training-cycle-routine.upsert'; cycleId: string; routine: TrainingCycleRoutineItem }
    | { type: 'training-cycle-routine.delete'; cycleId: string; routineId: string }
    | { type: 'training-cycle-routine.reorder'; cycleId: string; routineIds: string[] }
    | { type: 'active-cycle.set'; id: string | null }
    | { type: 'history.upsert'; workout: WorkoutSession }
    | { type: 'history.delete'; id: string }
    | { type: 'active-workout.set'; workout: WorkoutSession | null }
    | { type: 'workout.complete'; workout: WorkoutSession; activePains: string[] }
    | { type: 'active-pains.set'; pains: string[] }
    | { type: 'exercise.upsert'; exercise: Exercise }
    | { type: 'exercise.delete'; id: string }
    | { type: 'food.upsert'; food: Food & { id: string | number } }
    | { type: 'food.delete'; id: string | number }
    | { type: 'catalog.exercise.patch'; id: string; patch: ExerciseOverride }
    | { type: 'catalog.food.patch'; id: string; patch: FoodOverride }
    | { type: 'catalog.exercise.visibility'; id: string; hidden: boolean }
    | { type: 'catalog.food.visibility'; id: string; hidden: boolean }
    | { type: 'legal-consent.set'; consent: LegalConsent };

export type DomainOperationBatch = DomainOperation | readonly DomainOperation[];

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

function requireId(value: unknown, label: string): string {
    const id = String(value ?? '').trim();
    if (!id || id === 'undefined' || id === 'null' || id.includes('/')) {
        throw new Error(`${label}: identificativo non valido`);
    }
    return id;
}

function requireDate(date: string): string {
    if (!DATE_RE.test(date) || getLocalDateString(new Date(`${date}T12:00:00`)) !== date) {
        throw new Error('Data dominio non valida');
    }
    return date;
}

function assertUnique<T>(items: readonly T[], identity: (item: T) => string, label: string): void {
    const seen = new Set<string>();
    for (const item of items) {
        const id = identity(item);
        if (seen.has(id)) throw new Error(`${label}: identificativo duplicato ${id}`);
        seen.add(id);
    }
}

function upsertById<T>(items: readonly T[] | undefined, item: T, identity: (value: T) => string, label: string): T[] {
    const current = [...(items ?? [])];
    assertUnique(current, identity, label);
    const id = identity(item);
    const index = current.findIndex(value => identity(value) === id);
    if (index < 0) current.push(item);
    else current[index] = item;
    assertUnique(current, identity, label);
    return current;
}

function deleteById<T>(items: readonly T[] | undefined, id: string, identity: (value: T) => string, label: string): T[] {
    const current = [...(items ?? [])];
    assertUnique(current, identity, label);
    return current.filter(value => identity(value) !== id);
}

function reorderByIds<T>(items: readonly T[] | undefined, ids: readonly string[], identity: (value: T) => string, label: string): T[] {
    const current = [...(items ?? [])];
    assertUnique(current, identity, label);
    const normalized = ids.map(id => requireId(id, label));
    if (new Set(normalized).size !== normalized.length) throw new Error(`${label}: ordine duplicato`);
    const currentIds = current.map(identity);
    if (normalized.length !== currentIds.length || currentIds.some(id => !normalized.includes(id))) {
        throw new Error(`${label}: l'ordine deve contenere esattamente le entità correnti`);
    }
    const byId = new Map(current.map(item => [identity(item), item]));
    return normalized.map(id => byId.get(id)!);
}

function ensureNutritionDay(data: UserData, date: string): NutritionDay {
    const validDate = requireDate(date);
    return data.nutrition?.[validDate] ?? {
        date: validDate,
        kcal: 0,
        carbs: 0,
        pro: 0,
        fat: 0,
        meals: [],
        supplementsIntake: [],
    };
}

function withMealTotals(day: NutritionDay): NutritionDay {
    const totals = calculateLoggedMealTotals(day.meals ?? []);
    return { ...day, kcal: totals.kcal, carbs: totals.carbs, pro: totals.pro, fat: totals.fat };
}

function findRoutine(data: UserData, id: string): { index: number; value: WorkoutRoutine } {
    const normalized = requireId(id, 'Routine');
    const routines = data.routines ?? [];
    assertUnique(routines, routine => requireId(routine.id, 'Routine'), 'Routine');
    const index = routines.findIndex(routine => routine.id === normalized);
    if (index < 0) throw new Error(`Routine non trovata: ${normalized}`);
    return { index, value: routines[index] };
}

function findCycle(data: UserData, id: string): { index: number; value: TrainingCycle } {
    const normalized = requireId(id, 'Ciclo');
    const cycles = data.trainingCycles ?? [];
    assertUnique(cycles, cycle => requireId(cycle.id, 'Ciclo'), 'Ciclo');
    const index = cycles.findIndex(cycle => cycle.id === normalized);
    if (index < 0) throw new Error(`Ciclo non trovato: ${normalized}`);
    return { index, value: cycles[index] };
}

function applyOne(input: UserData, operation: DomainOperation): UserData {
    const data = structuredClone(input);

    switch (operation.type) {
        case 'profile.patch':
            data.profile = { ...(data.profile ?? {}), ...operation.patch };
            break;
        case 'nutrition-planning.replace':
            data.nutritionPlanning = structuredClone(operation.value);
            if (operation.origin) data.nutritionPlanningOrigin = operation.origin;
            break;
        case 'nutrition-day.patch': {
            const date = requireDate(operation.date);
            const day = ensureNutritionDay(data, date);
            data.nutrition = { ...(data.nutrition ?? {}), [date]: { ...day, ...operation.patch, date } };
            break;
        }
        case 'nutrition-day.delete': {
            const date = requireDate(operation.date);
            const nutrition = { ...(data.nutrition ?? {}) };
            delete nutrition[date];
            data.nutrition = nutrition;
            break;
        }
        case 'nutrition-meal.upsert': {
            const date = requireDate(operation.date);
            const mealId = requireId(operation.meal.id, 'Pasto');
            const day = ensureNutritionDay(data, date);
            const meals = upsertById(day.meals, { ...operation.meal, id: mealId }, meal => requireId(meal.id, 'Pasto'), 'Pasti');
            data.nutrition = { ...(data.nutrition ?? {}), [date]: withMealTotals({ ...day, date, meals }) };
            break;
        }
        case 'nutrition-meal.delete': {
            const date = requireDate(operation.date);
            const mealId = requireId(operation.mealId, 'Pasto');
            const day = ensureNutritionDay(data, date);
            const meals = deleteById(day.meals, mealId, meal => requireId(meal.id, 'Pasto'), 'Pasti');
            data.nutrition = { ...(data.nutrition ?? {}), [date]: withMealTotals({ ...day, date, meals }) };
            break;
        }
        case 'supplement-intake.upsert': {
            const date = requireDate(operation.date);
            const intakeId = requireId(operation.intake.id, 'Assunzione integratore');
            requireId(operation.intake.supplementId, 'Integratore');
            const day = ensureNutritionDay(data, date);
            const supplementsIntake = upsertById(
                day.supplementsIntake,
                { ...operation.intake, id: intakeId },
                intake => requireId(intake.id, 'Assunzione integratore'),
                'Assunzioni integratori',
            );
            data.nutrition = { ...(data.nutrition ?? {}), [date]: { ...day, date, supplementsIntake } };
            break;
        }
        case 'supplement-intake.delete': {
            const date = requireDate(operation.date);
            const intakeId = requireId(operation.intakeId, 'Assunzione integratore');
            const day = ensureNutritionDay(data, date);
            const supplementsIntake = deleteById(
                day.supplementsIntake,
                intakeId,
                intake => requireId(intake.id, 'Assunzione integratore'),
                'Assunzioni integratori',
            );
            data.nutrition = { ...(data.nutrition ?? {}), [date]: { ...day, date, supplementsIntake } };
            break;
        }
        case 'supplement.upsert': {
            const supplement = { ...operation.supplement, id: requireId(operation.supplement.id, 'Integratore') };
            data.supplements = upsertById(data.supplements, supplement, item => requireId(item.id, 'Integratore'), 'Integratori');
            break;
        }
        case 'supplement.delete':
            data.supplements = deleteById(data.supplements, requireId(operation.id, 'Integratore'), item => requireId(item.id, 'Integratore'), 'Integratori');
            break;
        case 'supplement.reorder':
            data.supplements = reorderByIds(data.supplements, operation.ids, item => requireId(item.id, 'Integratore'), 'Integratori');
            break;
        case 'routine.upsert': {
            const routine = { ...operation.routine, id: requireId(operation.routine.id, 'Routine') };
            assertUnique(routine.exercises ?? [], item => requireId(item.exId, 'Esercizio routine'), 'Esercizi routine');
            data.routines = upsertById(data.routines, routine, item => requireId(item.id, 'Routine'), 'Routine');
            break;
        }
        case 'routine.delete':
            data.routines = deleteById(data.routines, requireId(operation.id, 'Routine'), item => requireId(item.id, 'Routine'), 'Routine');
            break;
        case 'routine.reorder':
            data.routines = reorderByIds(data.routines, operation.ids, item => requireId(item.id, 'Routine'), 'Routine');
            break;
        case 'routine-exercise.upsert': {
            const { index, value } = findRoutine(data, operation.routineId);
            const exercise = { ...operation.exercise, exId: requireId(operation.exercise.exId, 'Esercizio routine') };
            const exercises = upsertById(value.exercises, exercise, item => requireId(item.exId, 'Esercizio routine'), 'Esercizi routine');
            data.routines = [...(data.routines ?? [])];
            data.routines[index] = { ...value, exercises };
            break;
        }
        case 'routine-exercise.delete': {
            const { index, value } = findRoutine(data, operation.routineId);
            const exercises = deleteById(value.exercises, requireId(operation.exId, 'Esercizio routine'), item => requireId(item.exId, 'Esercizio routine'), 'Esercizi routine');
            data.routines = [...(data.routines ?? [])];
            data.routines[index] = { ...value, exercises };
            break;
        }
        case 'routine-exercise.reorder': {
            const { index, value } = findRoutine(data, operation.routineId);
            const exercises = reorderByIds(value.exercises, operation.exIds, item => requireId(item.exId, 'Esercizio routine'), 'Esercizi routine');
            data.routines = [...(data.routines ?? [])];
            data.routines[index] = { ...value, exercises };
            break;
        }
        case 'training-cycle.upsert': {
            const cycle = { ...operation.cycle, id: requireId(operation.cycle.id, 'Ciclo') };
            assertUnique(cycle.routines ?? [], item => requireId(item.routineId, 'Routine ciclo'), 'Routine ciclo');
            data.trainingCycles = upsertById(data.trainingCycles, cycle, item => requireId(item.id, 'Ciclo'), 'Cicli');
            break;
        }
        case 'training-cycle.delete':
            data.trainingCycles = deleteById(data.trainingCycles, requireId(operation.id, 'Ciclo'), item => requireId(item.id, 'Ciclo'), 'Cicli');
            break;
        case 'training-cycle.reorder':
            data.trainingCycles = reorderByIds(data.trainingCycles, operation.ids, item => requireId(item.id, 'Ciclo'), 'Cicli');
            break;
        case 'training-cycle-routine.upsert': {
            const { index, value } = findCycle(data, operation.cycleId);
            const routine = { ...operation.routine, routineId: requireId(operation.routine.routineId, 'Routine ciclo') };
            const routines = upsertById(value.routines, routine, item => requireId(item.routineId, 'Routine ciclo'), 'Routine ciclo');
            data.trainingCycles = [...(data.trainingCycles ?? [])];
            data.trainingCycles[index] = { ...value, routines };
            break;
        }
        case 'training-cycle-routine.delete': {
            const { index, value } = findCycle(data, operation.cycleId);
            const routines = deleteById(value.routines, requireId(operation.routineId, 'Routine ciclo'), item => requireId(item.routineId, 'Routine ciclo'), 'Routine ciclo');
            data.trainingCycles = [...(data.trainingCycles ?? [])];
            data.trainingCycles[index] = { ...value, routines };
            break;
        }
        case 'training-cycle-routine.reorder': {
            const { index, value } = findCycle(data, operation.cycleId);
            const routines = reorderByIds(value.routines, operation.routineIds, item => requireId(item.routineId, 'Routine ciclo'), 'Routine ciclo');
            data.trainingCycles = [...(data.trainingCycles ?? [])];
            data.trainingCycles[index] = { ...value, routines };
            break;
        }
        case 'active-cycle.set':
            data.activeCycleId = operation.id === null ? null : requireId(operation.id, 'Ciclo attivo');
            break;
        case 'history.upsert': {
            const workout = { ...operation.workout, id: requireId(operation.workout.id, 'Allenamento') };
            requireDate(workout.date ?? (workout.globalStartTime ? getLocalDateString(workout.globalStartTime) : ''));
            const current = data.history ?? [];
            assertUnique(current, item => requireId(item.id, 'Allenamento'), 'Storico allenamenti');
            const index = current.findIndex(item => item.id === workout.id);
            data.history = index < 0
                ? [workout, ...current]
                : current.map((item, itemIndex) => itemIndex === index ? workout : item);
            break;
        }
        case 'history.delete':
            data.history = deleteById(data.history, requireId(operation.id, 'Allenamento'), item => requireId(item.id, 'Allenamento'), 'Storico allenamenti');
            break;
        case 'active-workout.set':
            if (operation.workout?.id !== undefined) requireId(operation.workout.id, 'Allenamento attivo');
            data.activeWorkout = operation.workout ? structuredClone(operation.workout) : null;
            break;
        case 'workout.complete': {
            const workout = { ...operation.workout, id: requireId(operation.workout.id, 'Allenamento') };
            requireDate(workout.date ?? (workout.globalStartTime ? getLocalDateString(workout.globalStartTime) : ''));
            const current = data.history ?? [];
            assertUnique(current, item => requireId(item.id, 'Allenamento'), 'Storico allenamenti');
            data.history = [workout, ...current.filter(item => item.id !== workout.id)];
            data.activeWorkout = null;
            data.activePains = [...operation.activePains];
            break;
        }
        case 'active-pains.set':
            data.activePains = [...operation.pains];
            break;
        case 'exercise.upsert': {
            const exercise = { ...operation.exercise, id: requireId(operation.exercise.id, 'Esercizio') };
            data.library = upsertById(data.library, exercise, item => requireId(item.id, 'Esercizio'), 'Archivio esercizi');
            break;
        }
        case 'exercise.delete':
            data.library = deleteById(data.library, requireId(operation.id, 'Esercizio'), item => requireId(item.id, 'Esercizio'), 'Archivio esercizi');
            break;
        case 'food.upsert': {
            const id = requireId(operation.food.id, 'Alimento');
            const food = { ...operation.food, id: operation.food.id };
            data.customFoods = upsertById(data.customFoods, food, item => requireId(item.id, 'Alimento'), 'Archivio alimenti');
            if (!id) throw new Error('Alimento non valido');
            break;
        }
        case 'food.delete':
            data.customFoods = deleteById(data.customFoods, requireId(operation.id, 'Alimento'), item => requireId(item.id, 'Alimento'), 'Archivio alimenti');
            break;
        case 'catalog.exercise.patch': {
            const id = requireId(operation.id, 'Override esercizio');
            const overrides = data.catalogOverrides ?? {};
            data.catalogOverrides = {
                ...overrides,
                exercises: { ...(overrides.exercises ?? {}), [id]: { ...(overrides.exercises?.[id] ?? {}), ...operation.patch } },
            };
            break;
        }
        case 'catalog.food.patch': {
            const id = requireId(operation.id, 'Override alimento');
            const overrides = data.catalogOverrides ?? {};
            data.catalogOverrides = {
                ...overrides,
                foods: { ...(overrides.foods ?? {}), [id]: { ...(overrides.foods?.[id] ?? {}), ...operation.patch } },
            };
            break;
        }
        case 'catalog.exercise.visibility': {
            const id = requireId(operation.id, 'Visibilità esercizio');
            const overrides = data.catalogOverrides ?? {};
            const hidden = new Set(overrides.hiddenExerciseIds ?? []);
            if (operation.hidden) hidden.add(id); else hidden.delete(id);
            data.catalogOverrides = { ...overrides, hiddenExerciseIds: [...hidden] };
            break;
        }
        case 'catalog.food.visibility': {
            const id = requireId(operation.id, 'Visibilità alimento');
            const overrides = data.catalogOverrides ?? {};
            const hidden = new Set((overrides.hiddenFoodIds ?? []).map(String));
            if (operation.hidden) hidden.add(id); else hidden.delete(id);
            data.catalogOverrides = { ...overrides, hiddenFoodIds: [...hidden] };
            break;
        }
        case 'legal-consent.set':
            data.legalConsent = structuredClone(operation.consent);
            break;
    }

    return UserDataSchema.parse(data) as unknown as UserData;
}

export function normalizeDomainOperationBatch(batch: DomainOperationBatch): DomainOperation[] {
    const operations = Array.isArray(batch) ? [...batch] : [batch];
    if (!operations.length) throw new Error('Batch di dominio vuoto');
    return operations;
}

export function applyDomainOperations(input: UserData, batch: DomainOperationBatch): UserData {
    return normalizeDomainOperationBatch(batch).reduce((state, operation) => applyOne(state, operation), structuredClone(input));
}

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
