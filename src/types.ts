export interface UserProfile {
    dob?: string;
    height?: string;
    gender?: 'M' | 'F' | string;
    neck?: string;
    waist?: string;
    hip?: string;
    hips?: string;
    manualBf?: string;
}

export interface MacroTarget {
    kcal: number;
    carbs: number;
    pro: number;
    fat: number;
}

export interface NutritionPlanning {
    weight?: number;
    carbsPerKg?: number;
    proPerKg?: number;
    fatPerKg?: number;
    lockedMacro?: 'carbs' | 'pro' | 'fat' | string | null;
    chartPeriod?: number;
    normocalorica?: Partial<MacroTarget>;
    totalKcal?: number;
}

export interface ExerciseSet {
    weight: string;
    reps: string;
    time?: string;
    done: boolean;
}

export interface Exercise {
    id: string;
    name: string;
    notes?: string;
    setsCount: number;
    muscles?: string[];
    secondaryMuscles?: string[];
    sets: ExerciseSet[];
    trackingType?: 'weight_reps' | 'time';
}

export interface RoutineExercise {
    exId: string;
    setsCount: number | string;
    minReps?: number | string;
    maxReps?: number | string;
    defaultTechnique?: 'none' | 'dropset' | 'isometrics';
}

export interface WorkoutRoutine {
    id: string;
    name: string;
    exercises: RoutineExercise[];
}

export interface SessionExerciseSet {
    id: string;
    kg: string;
    reps: string;
    time?: string;
    done?: boolean;
    dropsets?: { id: string; kg: string; reps: string }[];
    isometrics?: { id: string; kg: string; time: string }[];
}

export interface SessionExercise {
    exId: string;
    sessionNote: string;
    sets: SessionExerciseSet[];
    minReps?: number;
    maxReps?: number;
}

export interface WorkoutSession {
    id?: string;
    routineId?: string;
    routineName?: string;
    cycleId?: string;
    cycleName?: string;
    date?: string;
    globalStartTime?: number;
    globalEndTime?: number;
    globalDurationStr?: string;
    manualDurationStr?: string;
    moodRating?: number | null;
    pumpRating?: number | null;
    fatigueRating?: number | null;
    waterLiters?: number;
    endTime?: number;
    exercises: SessionExercise[];
    isEditingHistory?: boolean;
    originalHistoryId?: string;
}

export interface LoggedMealItem {
    id: string;
    name: string;
    meal: string; // 'colazione' | 'pranzo' | 'cena' | 'spuntino' | 'quick' | string
    quantity: number;
    baseQty?: number;
    unit?: string;
    kcal: number;
    carbs: number;
    pro: number;
    fat: number;
    time?: number;
    foodId?: string | number;
    brand?: string;
}

export type Meal = LoggedMealItem;
export type Routine = WorkoutRoutine;
export type ExerciseLibraryItem = Exercise;

export interface NutritionDay {
    date: string;
    kcal: number;
    carbs: number;
    pro: number;
    fat: number;
    weight?: number | string;
    bf?: number | string;
    neck?: number | string;
    waist?: number | string;
    hip?: number | string;
    measurementTime?: string;
    meals?: LoggedMealItem[];
}

export interface Food {
    id?: string | number;
    name: string;
    kcal: number;
    pro: number;
    carbs: number;
    fat: number;
    brand?: string;
    category?: string;
    baseQty?: number;
    unit?: string;
    servingUnit?: string;
    servingWeight?: number | null;
    isCustom?: boolean;
    satFat?: number | null;
    sugars?: number | null;
    sodium?: number | null;
    fiber?: number | null;
    iron?: number | null;
    potassium?: number | null;
    calcium?: number | null;
    magnesium?: number | null;
    cholesterol?: number | null;
}

export interface TrainingCycleRoutineItem {
    routineId: string;
    frequencyPerWeek: number; // es. 1, 2, 3
}

export interface TrainingCycle {
    id: string;
    name: string;
    durationWeeks: number; // es. 4, 6, 8, 12
    sessionsPerWeek?: number; // es. 1, 2, 3, 4, 5... (frequenza di allenamento settimanale)
    progressionMode?: 'sequential' | 'fixed'; // rotazione sequenziale continua vs fissa
    startDate?: string; // es. YYYY-MM-DD
    notes?: string;
    routines: TrainingCycleRoutineItem[];
    createdAt?: number;
    isActive?: boolean;
}

export interface UserData {
    profile?: UserProfile;
    library?: Exercise[];
    routines?: WorkoutRoutine[];
    history?: WorkoutSession[];
    nutrition?: Record<string, NutritionDay>;
    customFoods?: Food[];
    activeWorkout?: WorkoutSession | null;
    nutritionPlanning?: NutritionPlanning;
    trainingCycles?: TrainingCycle[];
    activeCycleId?: string | null;
}

