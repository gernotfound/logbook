/**
 * LogBook - Privacy-Safe Analytics Types & Event Taxonomy
 * Strict Zero-PII / Zero-Health Data Definitions
 */

export type AnalyticsConsentStatus = 'granted' | 'denied' | 'prompt';

export const STORAGE_KEY_ANALYTICS_CONSENT = 'logbook_analytics_consent';
export const STORAGE_KEY_ANALYTICS_CONSENT_DATE = 'logbook_analytics_consent_date';

export type PlatformType = 'ios' | 'android' | 'desktop';
export type ScreenName = 'home' | 'training' | 'nutrition' | 'data' | 'settings';
export type DurationBucket = '<30m' | '30-60m' | '60-90m' | '>90m';
export type ExerciseCountBucket = '1-3' | '4-6' | '7-10' | '>10';
export type RoutineExerciseCountBucket = '1-5' | '6-10' | '>10';
export type MealsCountBucket = '1-3' | '4-6' | '>6';
export type CycleDurationBucket = '1-4' | '5-8' | '9-12' | '>12';
export type AppCheckStatus = 'success' | 'fallback_offline' | 'unsupported';

export interface AppOpenedEventParams {
  platform: PlatformType;
  is_pwa: boolean;
  is_guest: boolean;
}

export interface ScreenViewEventParams {
  screen_name: ScreenName;
}

export interface SubTabViewEventParams {
  tab_name: string;
  sub_tab_name: string;
}

export interface WorkoutSessionLoggedEventParams {
  duration_bucket: DurationBucket;
  exercises_count_bucket: ExerciseCountBucket;
  is_routine_based: boolean;
}

export interface NutritionDayLoggedEventParams {
  has_meals: boolean;
  has_measurements: boolean;
  meals_count_bucket: MealsCountBucket;
}

export interface RoutineCreatedEventParams {
  exercises_count_bucket: RoutineExerciseCountBucket;
}

export interface TrainingCycleCreatedEventParams {
  duration_weeks_bucket: CycleDurationBucket;
}

export interface CsvExportTriggeredEventParams {
  has_workouts: boolean;
  has_nutrition: boolean;
}

export interface PwaInstalledEventParams {
  platform: PlatformType;
}

export interface AppCheckResultEventParams {
  status: AppCheckStatus;
}

export interface SyncErrorOccurredEventParams {
  error_category: string;
  error_code: string;
  is_offline: boolean;
}

export interface EventParamsMap {
  app_opened: AppOpenedEventParams;
  screen_view: ScreenViewEventParams;
  sub_tab_view: SubTabViewEventParams;
  workout_session_logged: WorkoutSessionLoggedEventParams;
  nutrition_day_logged: NutritionDayLoggedEventParams;
  routine_created: RoutineCreatedEventParams;
  training_cycle_created: TrainingCycleCreatedEventParams;
  csv_export_triggered: CsvExportTriggeredEventParams;
  pwa_installed: PwaInstalledEventParams;
  app_check_result: AppCheckResultEventParams;
  sync_error_occurred: SyncErrorOccurredEventParams;
}

export type AllowedEventName = keyof EventParamsMap;

/**
 * Whitelist of allowed parameters per event name.
 * Any key NOT explicitly in this whitelist will be stripped by the sanitizer.
 */
export const EVENT_PARAM_WHITELIST: Record<AllowedEventName, readonly string[]> = {
  app_opened: ['platform', 'is_pwa', 'is_guest'],
  screen_view: ['screen_name'],
  sub_tab_view: ['tab_name', 'sub_tab_name'],
  workout_session_logged: ['duration_bucket', 'exercises_count_bucket', 'is_routine_based'],
  nutrition_day_logged: ['has_meals', 'has_measurements', 'meals_count_bucket'],
  routine_created: ['exercises_count_bucket'],
  training_cycle_created: ['duration_weeks_bucket'],
  csv_export_triggered: ['has_workouts', 'has_nutrition'],
  pwa_installed: ['platform'],
  app_check_result: ['status'],
  sync_error_occurred: ['error_category', 'error_code', 'is_offline'],
};

/**
 * Blacklist of sensitive/health/PII fields that must NEVER appear in analytics payloads.
 */
export const SENSITIVE_FIELD_BLACKLIST = [
  'uid',
  'userId',
  'user_id',
  'email',
  'name',
  'displayName',
  'photoURL',
  'foodName',
  'food_name',
  'exerciseName',
  'exercise_name',
  'weight',
  'body_weight',
  'kg',
  'reps',
  'kcal',
  'calories',
  'carbs',
  'pro',
  'protein',
  'fat',
  'fats',
  'notes',
  'sessionNote',
  'pains',
  'activePains',
  'measurements',
  'bf',
  'body_fat',
  'neck',
  'waist',
  'hip',
  'hips',
  'chest',
  'shoulders',
  'biceps',
  'thighs',
  'calves',
  'sleep',
  'sleepHours',
  'sleepDeep',
  'sleepLight',
  'sleepRem',
  'sleepAwake',
  'supplement',
  'supplements',
  'moodRating',
  'pumpRating',
  'fatigueRating',
] as const;
