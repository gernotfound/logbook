export interface UserProfile {
    dob?: string;
    height?: string;
    gender?: 'M' | 'F' | string;
    neck?: string;
    waist?: string;
    hip?: string;
    hips?: string;
    manualBf?: string;
    chest?: string;
    shoulders?: string;
    biceps?: string;
    thighs?: string;
    calves?: string;
}

export interface MacroTarget {
    kcal: number;
    carbs: number;
    pro: number;
    fat: number;
}

export interface NutritionPlanning {
    weight?: number;
    onDaysCount?: number;
    avgMacros?: { carbsPerKg: number; proPerKg: number; fatPerKg: number };
    onBoost?: { carbsPercent: number; proPercent: number; fatPercent: number };
    onMacros?: { carbsPerKg: number; proPerKg: number; fatPerKg: number };
    offMacros?: { carbsPerKg: number; proPerKg: number; fatPerKg: number };
    notes?: string;
    // Legacy fields
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
    trackingType?: 'weight_reps' | 'time' | 'cardio';
    isDefault?: boolean;
    isBodyweight?: boolean;
    equipmentWeight?: number;
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
    distance?: string;
    speed?: string;
    incline?: string;
    kcal?: string;
    done?: boolean;
    dropsets?: { id: string; kg: string; reps: string }[];
    isometrics?: { id: string; kg: string; time: string }[];
}

export interface SessionExercise {
    id?: string;
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
    // Snapshot captured when the session starts. Absence means the historical intent was unspecified.
    cycleStrategy?: TrainingCycleStrategy;
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
    pains?: string[];
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

export interface Supplement {
    id: string;
    name: string;
    unit: string;
    target?: number;
    portion?: number;
}

export interface SupplementIntake {
    id: string;
    supplementId: string;
    amount: number;
    time: number;
}

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
    hips?: number | string;
    chest?: number | string;
    shoulders?: number | string;
    biceps?: number | string;
    thighs?: number | string;
    calves?: number | string;
    measurementTime?: string;
    isDayOn?: boolean;
    meals?: LoggedMealItem[];
    supplementsIntake?: SupplementIntake[];
    sleepHours?: number | string;
    sleepDeep?: number | string;
    sleepLight?: number | string;
    sleepRem?: number | string;
    sleepAwake?: number | string;
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

export type TrainingCycleIntent = 'development' | 'maintenance' | 'deload';
export type TrainingCycleProgressionFocus = 'performance' | 'volume' | 'density' | 'execution';

export interface TrainingCycleStrategy {
    intent: TrainingCycleIntent;
    progressionFocus?: TrainingCycleProgressionFocus;
    primaryMuscles?: string[];
    secondaryMuscles?: string[];
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
    endDate?: string; // es. YYYY-MM-DD
    notes?: string;
    strategy?: TrainingCycleStrategy;
    routines: TrainingCycleRoutineItem[];
    createdAt?: number;
    isActive?: boolean;
}

export interface ExportShareOptions {
    exportLibrary?: boolean | string[];
    exportRoutines?: boolean | string[];
    exportTrainingCycles?: boolean | string[];
}

export interface CatalogManifest {
    version: string;
    updatedAt: string;
    schemaVersion: number;
    docRefs: {
        exercises: string;
        foods: string;
    };
    itemCounts: {
        exercises: number;
        foods: number;
    };
}

export interface CatalogExercise {
    id: string;
    name: string;
    muscles?: string[];
    secondaryMuscles?: string[];
    trackingType?: 'weight_reps' | 'time' | 'cardio';
    isDefault?: boolean;
    isBodyweight?: boolean;
    equipmentWeight?: number;
    notes?: string;
    setsCount?: number;
}

export interface CatalogFood {
    id: string | number;
    name: string;
    brand?: string;
    category?: string;
    kcal: number;
    pro: number;
    carbs: number;
    fat: number;
    baseQty?: number;
    unit?: string;
    servingUnit?: string;
    servingWeight?: number | null;
    isCustom?: boolean;
    satFat?: number;
    sugars?: number;
    sodium?: number;
    fiber?: number;
    iron?: number;
    potassium?: number;
    calcium?: number;
    magnesium?: number;
    cholesterol?: number;
}

export interface CachedGlobalCatalog {
    manifest: CatalogManifest;
    exercises: CatalogExercise[];
    foods: CatalogFood[];
    cachedAt: number;
}

export interface ExerciseOverride {
    name?: string;
    notes?: string;
    muscles?: string[];
    secondaryMuscles?: string[];
    equipmentWeight?: number;
    isBodyweight?: boolean;
    trackingType?: 'weight_reps' | 'time' | 'cardio';
}

export interface FoodOverride {
    name?: string;
    brand?: string;
    category?: string;
    kcal?: number;
    pro?: number;
    carbs?: number;
    fat?: number;
    baseQty?: number;
    unit?: string;
    servingUnit?: string;
    servingWeight?: number | null;
}

export interface CatalogOverrides {
    exercises?: Record<string, ExerciseOverride>;
    foods?: Record<string, FoodOverride>;
    hiddenExerciseIds?: string[];
    hiddenFoodIds?: string[];
}

export interface LegalConsent {
    hasAcceptedTerms: boolean;
    hasAcceptedHealthData: boolean;
    acceptedAt: string;
    privacyVersion: string;
    termsVersion: string;
}

export interface UserData {
    profile?: UserProfile;
    library?: Exercise[]; // Legacy, pre-migration
    routines?: WorkoutRoutine[];
    history?: WorkoutSession[];
    nutrition?: Record<string, NutritionDay>;
    customFoods?: Food[]; // Legacy, pre-migration
    activeWorkout?: WorkoutSession | null;
    nutritionPlanning?: NutritionPlanning;
    trainingCycles?: TrainingCycle[];
    activeCycleId?: string | null;
    supplements?: Supplement[];
    activePains?: string[];
    catalogOverrides?: CatalogOverrides; // New global catalog overrides
    legalConsent?: LegalConsent;
    nutritionPlanningOrigin?: 'generated-default' | 'user-edited';
    pendingConflicts?: {
        nutritionPlanning?: NutritionPlanning;
    };
}

declare global {
    interface Window {
        __INITIAL_USER_DATA__?: UserData | null;
    }
}


export type SyncResult =
    | { ok: true; status: 'synced' }
    | { ok: false; status: 'local-pending'; error: unknown }
    | { ok: false; status: 'rejected'; error: unknown }
    | { ok: false; status: 'failed'; error: unknown };

export type ResolveNutritionConflictInput = {
    resolution: 'cloud' | 'local';
    expectedUid: string;
    expectedConflictFingerprint: string;
};

export type AppTab = 'home' | 'training' | 'nutrition' | 'data' | 'settings';
export type MainTab = AppTab;
export type TrainingSubTab = 'session' | 'planning' | 'routines' | 'exercises' | 'history';
export type NutritionSubTab = 'meals' | 'planning' | 'archive' | 'history' | 'supplements';
export type DataSubTab = 'measurements' | 'sleep' | 'biometry' | 'history';
