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
    targetMuscles?: string[];
    sets: ExerciseSet[];
}

export interface WorkoutRoutine {
    id: string;
    name: string;
    exercises: Exercise[];
}

export interface WorkoutSession {
    id: string;
    routineId?: string;
    routineName?: string;
    globalStartTime: number;
    endTime?: number;
    exercises: Exercise[];
}

export interface NutritionDay {
    date: string;
    kcal: number;
    carbs: number;
    pro: number;
    fat: number;
    weight?: string;
}

export interface UserData {
    profile: UserProfile;
    library: any[];
    routines: WorkoutRoutine[];
    history: WorkoutSession[];
    nutrition: Record<string, NutritionDay>;
    customFoods: any[];
    activeWorkout: WorkoutSession | null;
    nutritionPlanning: NutritionPlanning;
}
