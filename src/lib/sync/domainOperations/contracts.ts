import type {
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
    UserProfile,
    WorkoutRoutine,
    WorkoutSession,
} from '../../../types';

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
