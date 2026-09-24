import type {
    NutritionDay,
    TrainingCycle,
    UserData,
    WorkoutRoutine,
} from '../../../types';
import { UserDataSchema } from '../../schema';
import { CardioSessionSchema } from '../../schemas/schema_nutrition';
import { calculateLoggedMealTotals } from '../../nutrition/calculateLoggedMealTotals';
import { getLocalDateString } from '../../utils/date';
import type { DomainOperation, DomainOperationBatch } from './contracts';
import {
    applyPatch,
    assertUnique,
    deleteById,
    reorderByIds,
    requireDate,
    requireId,
    upsertById,
} from './validation';

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

function requireSteps(value: number): number {
    if (!Number.isFinite(value) || !Number.isInteger(value) || value < 0) throw new Error('Passi: valore non valido');
    return value;
}

function requireCapturedAt(value: number | undefined): number | undefined {
    if (value === undefined) return undefined;
    if (!Number.isFinite(value) || value < 0) throw new Error('Attività: timestamp non valido');
    return value;
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
            data.profile = applyPatch(data.profile ?? {}, operation.patch);
            break;
        case 'nutrition-planning.replace':
            data.nutritionPlanning = structuredClone(operation.value);
            if (operation.origin) data.nutritionPlanningOrigin = operation.origin;
            break;
        case 'nutrition-day.patch': {
            const date = requireDate(operation.date);
            const day = ensureNutritionDay(data, date);
            const patched = applyPatch<NutritionDay>(day, operation.patch);
            data.nutrition = { ...(data.nutrition ?? {}), [date]: { ...patched, date } };
            break;
        }
        case 'nutrition-day.delete': {
            const date = requireDate(operation.date);
            const nutrition = { ...(data.nutrition ?? {}) };
            delete nutrition[date];
            data.nutrition = nutrition;
            break;
        }
        case 'activity-steps.set': {
            const date = requireDate(operation.date);
            const day = ensureNutritionDay(data, date);
            const steps = requireSteps(operation.steps);
            const capturedAt = requireCapturedAt(operation.capturedAt);
            const next = { ...day, date, steps, stepsSource: operation.source ?? 'manual' as const };
            if (capturedAt === undefined) delete next.stepsCapturedAt;
            else next.stepsCapturedAt = capturedAt;
            data.nutrition = { ...(data.nutrition ?? {}), [date]: next };
            break;
        }
        case 'activity-steps.clear': {
            const date = requireDate(operation.date);
            const day = data.nutrition?.[date];
            if (!day) break;
            const next = { ...day };
            delete next.steps;
            delete next.stepsSource;
            delete next.stepsCapturedAt;
            data.nutrition = { ...(data.nutrition ?? {}), [date]: next };
            break;
        }
        case 'cardio-session.upsert': {
            const date = requireDate(operation.date);
            const day = ensureNutritionDay(data, date);
            const session = CardioSessionSchema.parse(operation.session);
            const id = requireId(session.id, 'Sessione cardio');
            const cardioSessions = upsertById(day.cardioSessions, { ...session, id }, item => requireId(item.id, 'Sessione cardio'), 'Sessioni cardio');
            data.nutrition = { ...(data.nutrition ?? {}), [date]: { ...day, date, cardioSessions } };
            break;
        }
        case 'cardio-session.delete': {
            const date = requireDate(operation.date);
            const sessionId = requireId(operation.sessionId, 'Sessione cardio');
            const day = data.nutrition?.[date];
            if (!day) break;
            const cardioSessions = deleteById(day.cardioSessions, sessionId, item => requireId(item.id, 'Sessione cardio'), 'Sessioni cardio');
            data.nutrition = { ...(data.nutrition ?? {}), [date]: { ...day, date, cardioSessions } };
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
            if (operation.workout) requireId(operation.workout.id, 'Allenamento attivo');
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
            data.library = upsertById(data.library, exercise, item => requireId(item.id, 'Esercizio'), 'Archivio esercizi')
                .sort((a, b) => a.name.localeCompare(b.name, 'it'));
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
