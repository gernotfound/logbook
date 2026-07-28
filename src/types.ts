export interface UserProfile {
    dob?: string;
    height?: string;
    gender?: 'M' | 'F' | '';
    neck?: string;
    waist?: string;
    hips?: string;
}

export interface MacroTarget {
    kcal: number;
    carbs: number;
    pro: number;
    fat: number;
}

export interface NutritionPlanning {
    weight: number;
    carbsPerKg: number;
    proPerKg: number;
    fatPerKg: number;
    lockedMacro: 'carbs' | 'pro' | 'fat' | null;
    chartPeriod: number;
    normocalorica: MacroTarget;
    totalKcal?: number;
}

export interface ExerciseSet {
    weight: string;
    reps: string;
    done: boolean;
}

export interface Exercise {
    id: string;
    name: string;
    notes?: string;
    setsCount: number;
    muscles?: string[];
    sets: ExerciseSet[];
}

export interface RoutineExercise {
    exId: string;
    setsCount: number;
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
    done?: boolean;
    dropsets?: { id: string; kg: string; reps: string }[];
    isometrics?: { id: string; kg: string; time: string }[];
}

export interface SessionExercise {
    exId: string;
    sessionNote: string;
    sets: SessionExerciseSet[];
}

export interface WorkoutSession {
    id?: string;
    routineId?: string;
    routineName?: string;
    date?: string;
    globalStartTime?: number;
    globalEndTime?: number;
    globalDurationStr?: string;
    moodRating?: number | null;
    pumpRating?: number | null;
    fatigueRating?: number | null;
    waterLiters?: number;
    endTime?: number;
    exercises: SessionExercise[];
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
    measurementTime?: string;
    meals?: Meal[];
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
    satFat?: number;
    sugars?: number;
    sodium?: number;
    fiber?: number;
    iron?: number;
}

export interface Meal {
    id: string;
    name: string;
    time: string;
    foods: { food: Food; quantity: number; unit?: string }[];
}

export interface UserData {
    profile: UserProfile;
    library: Exercise[];
    routines: WorkoutRoutine[];
    history: WorkoutSession[];
    nutrition: Record<string, NutritionDay>;
    customFoods: Food[];
    activeWorkout: WorkoutSession | null;
    nutritionPlanning: NutritionPlanning;
}
