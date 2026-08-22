import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  getAnalyticsConsent,
  setAnalyticsConsent,
  revokeConsent,
  isAnalyticsEnabled,
  logPrivacyEvent,
  sanitizePayload,
  setAnalyticsTransport,
  clearEventBuffer,
  getEventBuffer,
  bucketWorkoutDuration,
  bucketExerciseCount,
  bucketRoutineExerciseCount,
  bucketMealsCount,
  bucketCycleDuration,
} from '../src/analytics/privacyAnalytics.js';
import {
  STORAGE_KEY_ANALYTICS_CONSENT,
  SENSITIVE_FIELD_BLACKLIST,
} from '../src/analytics/analyticsTypes.js';

describe('Privacy-Safe Analytics Engine Suite', () => {
  const mockTransport = vi.fn();

  beforeEach(() => {
    localStorage.clear();
    clearEventBuffer();
    setAnalyticsTransport(mockTransport);
    vi.clearAllMocks();
  });

  describe('Opt-In Gate & Consent Lifecycle', () => {
    it('defaults to prompt state when no consent is stored', () => {
      expect(getAnalyticsConsent()).toBe('prompt');
      expect(isAnalyticsEnabled()).toBe(false);
    });

    it('blocks event logging when consent is not granted (default or denied)', () => {
      const logged = logPrivacyEvent('app_opened', {
        platform: 'ios',
        is_pwa: true,
        is_guest: false,
      });

      expect(logged).toBe(false);
      expect(mockTransport).not.toHaveBeenCalled();
      expect(getEventBuffer().length).toBe(0);
    });

    it('enables event logging once user explicitly grants consent', () => {
      setAnalyticsConsent('granted');
      expect(isAnalyticsEnabled()).toBe(true);
      expect(localStorage.getItem(STORAGE_KEY_ANALYTICS_CONSENT)).toBe('granted');

      const logged = logPrivacyEvent('app_opened', {
        platform: 'android',
        is_pwa: true,
        is_guest: true,
      });

      expect(logged).toBe(true);
      expect(mockTransport).toHaveBeenCalledWith('app_opened', {
        platform: 'android',
        is_pwa: true,
        is_guest: true,
      });
      expect(getEventBuffer().length).toBe(1);
    });

    it('immediately halts logging and wipes memory buffers on consent revocation', () => {
      setAnalyticsConsent('granted');
      logPrivacyEvent('app_opened', { platform: 'desktop', is_pwa: false, is_guest: false });
      expect(getEventBuffer().length).toBe(1);

      // User revokes consent
      revokeConsent();
      expect(isAnalyticsEnabled()).toBe(false);
      expect(getAnalyticsConsent()).toBe('denied');
      expect(getEventBuffer().length).toBe(0); // Memory buffer destroyed

      // Subsequent log attempts are discarded
      const loggedAfter = logPrivacyEvent('screen_view', { screen_name: 'settings' });
      expect(loggedAfter).toBe(false);
      expect(mockTransport).toHaveBeenCalledTimes(1); // No new transport call
    });
  });

  describe('Strict Zero-PII & Zero-Health Sanitization', () => {
    it('strips all sensitive user identity fields (uid, email, name)', () => {
      const rawPayload = {
        platform: 'ios' as const,
        is_pwa: true,
        is_guest: false,
        uid: 'user_secret_123',
        userId: 'user_secret_123',
        user_id: 'user_secret_123',
        email: 'user@example.com',
        name: 'Mario Rossi',
        displayName: 'Mario',
        photoURL: 'https://example.com/photo.jpg',
      };

      const sanitized = sanitizePayload('app_opened', rawPayload);

      expect(sanitized).toEqual({
        platform: 'ios',
        is_pwa: true,
        is_guest: false,
      });

      // Verify no sensitive keys leaked
      for (const field of SENSITIVE_FIELD_BLACKLIST) {
        expect(sanitized).not.toHaveProperty(field);
      }
    });

    it('strips workout health data (exercise names, kg, reps, notes, pains, ratings)', () => {
      const rawWorkoutPayload = {
        duration_bucket: '30-60m' as const,
        exercises_count_bucket: '4-6' as const,
        is_routine_based: true,
        exerciseName: 'Panca piana bilanciere',
        kg: '100',
        weight: '100kg',
        reps: '8',
        notes: 'Sessione pesante al petto',
        sessionNote: 'Dolore spalla sinistra',
        pains: ['shoulder_left'],
        moodRating: 4,
        pumpRating: 5,
        fatigueRating: 3,
      };

      const sanitized = sanitizePayload('workout_session_logged', rawWorkoutPayload);

      expect(sanitized).toEqual({
        duration_bucket: '30-60m',
        exercises_count_bucket: '4-6',
        is_routine_based: true,
      });

      expect(sanitized).not.toHaveProperty('exerciseName');
      expect(sanitized).not.toHaveProperty('kg');
      expect(sanitized).not.toHaveProperty('notes');
      expect(sanitized).not.toHaveProperty('pains');
    });

    it('strips nutrition and biometric health data (food names, kcal, macros, body measurements, sleep)', () => {
      const rawNutritionPayload = {
        has_meals: true,
        has_measurements: true,
        meals_count_bucket: '1-3' as const,
        foodName: 'Petto di pollo',
        kcal: 2500,
        calories: 2500,
        carbs: 300,
        pro: 180,
        fat: 60,
        weight: 78.5,
        body_fat: 12.5,
        waist: 82,
        neck: 38,
        chest: 105,
        sleepHours: '07:30',
        sleepDeep: '02:00',
      };

      const sanitized = sanitizePayload('nutrition_day_logged', rawNutritionPayload);

      expect(sanitized).toEqual({
        has_meals: true,
        has_measurements: true,
        meals_count_bucket: '1-3',
      });

      expect(sanitized).not.toHaveProperty('foodName');
      expect(sanitized).not.toHaveProperty('kcal');
      expect(sanitized).not.toHaveProperty('weight');
      expect(sanitized).not.toHaveProperty('waist');
      expect(sanitized).not.toHaveProperty('sleepHours');
    });
  });

  describe('Bucketing Helper Functions', () => {
    it('buckets workout duration correctly across boundary thresholds', () => {
      expect(bucketWorkoutDuration(15)).toBe('<30m');
      expect(bucketWorkoutDuration(29)).toBe('<30m');
      expect(bucketWorkoutDuration(30)).toBe('30-60m');
      expect(bucketWorkoutDuration(60)).toBe('30-60m');
      expect(bucketWorkoutDuration(61)).toBe('60-90m');
      expect(bucketWorkoutDuration(90)).toBe('60-90m');
      expect(bucketWorkoutDuration(91)).toBe('>90m');
      expect(bucketWorkoutDuration(150)).toBe('>90m');
    });

    it('buckets exercise counts correctly', () => {
      expect(bucketExerciseCount(1)).toBe('1-3');
      expect(bucketExerciseCount(3)).toBe('1-3');
      expect(bucketExerciseCount(4)).toBe('4-6');
      expect(bucketExerciseCount(6)).toBe('4-6');
      expect(bucketExerciseCount(7)).toBe('7-10');
      expect(bucketExerciseCount(10)).toBe('7-10');
      expect(bucketExerciseCount(11)).toBe('>10');
    });

    it('buckets routine exercise counts correctly', () => {
      expect(bucketRoutineExerciseCount(3)).toBe('1-5');
      expect(bucketRoutineExerciseCount(5)).toBe('1-5');
      expect(bucketRoutineExerciseCount(6)).toBe('6-10');
      expect(bucketRoutineExerciseCount(10)).toBe('6-10');
      expect(bucketRoutineExerciseCount(12)).toBe('>10');
    });

    it('buckets meals count correctly', () => {
      expect(bucketMealsCount(1)).toBe('1-3');
      expect(bucketMealsCount(3)).toBe('1-3');
      expect(bucketMealsCount(4)).toBe('4-6');
      expect(bucketMealsCount(6)).toBe('4-6');
      expect(bucketMealsCount(7)).toBe('>6');
    });

    it('buckets cycle duration weeks correctly', () => {
      expect(bucketCycleDuration(4)).toBe('1-4');
      expect(bucketCycleDuration(5)).toBe('5-8');
      expect(bucketCycleDuration(8)).toBe('5-8');
      expect(bucketCycleDuration(9)).toBe('9-12');
      expect(bucketCycleDuration(12)).toBe('9-12');
      expect(bucketCycleDuration(16)).toBe('>12');
    });
  });
});
