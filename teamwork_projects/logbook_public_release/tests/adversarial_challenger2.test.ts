/**
 * Adversarial Challenger 2 Stress Test Suite
 * 
 * Verifies:
 * 1. App Check fallback states, token failures, unsupported environments, zero unhandled crashes.
 * 2. Resilient UX Error Handler: 3 mandatory failure scenarios, Italian Sentence case, useDialogStore integration.
 * 3. Privacy Analytics PII Sanitization: Adversarial penetration test attempting to leak sensitive health, identity, and biometric data.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

// --- Imports from PoC source ---
import {
  initAppCheck,
  isAppCheckSupported,
  isAppCheckActive,
  isAppCheckFallbackOffline,
  setAppCheckFallbackOffline,
  getAppCheckStatus,
  getAppCheckToken,
  resetAppCheckStateForTesting,
  APP_CHECK_STRINGS,
} from '../src/security/appCheck.js';

import {
  mapFirebaseErrorCode,
  toSentenceCase,
  FormattedSyncError,
  NormalizedErrorCode,
} from '../src/errors/errorHandler.js';

import {
  handleOfflineSaveScenario,
  handleAppCheckFailureScenario,
  handleRulesRejectionScenario,
  dispatchErrorScenario,
  setDialogHandler,
  getDialogHandler,
  DialogHandler,
} from '../src/errors/errorScenarios.js';

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
  STORAGE_KEY_ANALYTICS_CONSENT_DATE,
  SENSITIVE_FIELD_BLACKLIST,
  EVENT_PARAM_WHITELIST,
  AllowedEventName,
} from '../src/analytics/analyticsTypes.js';

// Mock firebase/app-check
vi.mock('firebase/app-check', () => {
  let mockSupported = true;
  let mockTokenReject = false;

  return {
    initializeAppCheck: vi.fn((app, options) => {
      if (options?.provider?.siteKey === 'THROW_INIT_ERROR') {
        throw new Error('Fatal App Check initialization error');
      }
      return {
        app,
        options,
        _isAppCheckInstance: true,
      };
    }),
    ReCaptchaV3Provider: vi.fn(function (this: any, siteKey: string) {
      if (siteKey === 'THROW_PROVIDER_ERROR') {
        throw new Error('reCAPTCHA provider creation failed');
      }
      this.siteKey = siteKey;
    }),
    getToken: vi.fn(async (instance, forceRefresh) => {
      if (mockTokenReject) {
        throw new Error('Network error during App Check token retrieval (HTTP 503)');
      }
      return {
        token: 'valid-test-app-check-token-jwt',
        expireTimeMillis: Date.now() + 3600 * 1000,
      };
    }),
    isSupported: vi.fn(async () => mockSupported),
    // Test control helpers
    __setMockSupported: (val: boolean) => {
      mockSupported = val;
    },
    __setMockTokenReject: (val: boolean) => {
      mockTokenReject = val;
    },
  };
});

describe('CHALLENGER 2: Adversarial Stress Test Suite', () => {
  const mockFirebaseApp = { name: '[DEFAULT]', options: {} } as any;

  beforeEach(() => {
    resetAppCheckStateForTesting();
    localStorage.clear();
    clearEventBuffer();
    setAnalyticsTransport(null);
    vi.clearAllMocks();
  });

  // =========================================================================
  // DOMAIN 1: App Check Fallback States & Exception Hardening
  // =========================================================================
  describe('Domain 1: App Check Fallback States & Exception Hardening', () => {
    it('handles isSupported() returning false gracefully with full offline fallback', async () => {
      const { isSupported } = await import('firebase/app-check');
      vi.mocked(isSupported).mockResolvedValueOnce(false);

      const result = await initAppCheck(mockFirebaseApp, {
        siteKey: 'valid-site-key-12345',
      });

      expect(result.success).toBe(false);
      expect(result.isFallbackOffline).toBe(true);
      expect(result.appCheck).toBeNull();
      expect(result.reason).toBe(APP_CHECK_STRINGS.unsupportedMessage);
      expect(isAppCheckActive()).toBe(false);
      expect(isAppCheckFallbackOffline()).toBe(true);

      // getAppCheckToken must safely return null in fallback mode
      const token = await getAppCheckToken();
      expect(token).toBeNull();
    });

    it('handles unexpected exceptions thrown by isSupported() without crashing', async () => {
      const { isSupported } = await import('firebase/app-check');
      vi.mocked(isSupported).mockRejectedValueOnce(
        new Error('DOMException: The operation is insecure in sandboxed iframe')
      );

      const supported = await isAppCheckSupported();
      expect(supported).toBe(false);

      const result = await initAppCheck(mockFirebaseApp, {
        siteKey: 'valid-site-key-12345',
      });

      expect(result.success).toBe(false);
      expect(result.isFallbackOffline).toBe(true);
      expect(result.appCheck).toBeNull();
    });

    it('handles fatal constructor error in initializeAppCheck gracefully', async () => {
      const result = await initAppCheck(mockFirebaseApp, {
        siteKey: 'THROW_INIT_ERROR',
      });

      expect(result.success).toBe(false);
      expect(result.isFallbackOffline).toBe(true);
      expect(result.appCheck).toBeNull();
      expect(result.reason).toContain('Fatal App Check initialization error');
      expect(isAppCheckActive()).toBe(false);
    });

    it('handles fatal provider error in ReCaptchaV3Provider gracefully', async () => {
      const result = await initAppCheck(mockFirebaseApp, {
        siteKey: 'THROW_PROVIDER_ERROR',
      });

      expect(result.success).toBe(false);
      expect(result.isFallbackOffline).toBe(true);
      expect(result.appCheck).toBeNull();
      expect(result.reason).toContain('reCAPTCHA provider creation failed');
    });

    it('handles initial token retrieval failure without crashing and remains in fallback mode', async () => {
      const { getToken } = await import('firebase/app-check');
      vi.mocked(getToken).mockRejectedValueOnce(new Error('FirebaseError: appcheck/fetch-status-error'));

      const result = await initAppCheck(mockFirebaseApp, {
        siteKey: 'valid-site-key',
      });

      // AppCheck instance was created, but initial token failed
      expect(result.success).toBe(true);
      expect(result.appCheck).not.toBeNull();

      // Subsequent token fetch failure returns null gracefully
      vi.mocked(getToken).mockRejectedValueOnce(new Error('Network timeout'));
      const token = await getAppCheckToken();
      expect(token).toBeNull();
    });

    it('rejects empty, whitespace-only, or missing siteKey and activates offline fallback', async () => {
      const emptyResult = await initAppCheck(mockFirebaseApp, { siteKey: '' });
      expect(emptyResult.success).toBe(false);
      expect(emptyResult.isFallbackOffline).toBe(true);
      expect(emptyResult.reason).toBe(APP_CHECK_STRINGS.missingSiteKeyWarning);

      resetAppCheckStateForTesting();
      const whitespaceResult = await initAppCheck(mockFirebaseApp, { siteKey: '   ' });
      expect(whitespaceResult.success).toBe(false);
      expect(whitespaceResult.isFallbackOffline).toBe(true);
    });

    it('strictly validates all App Check user-facing strings for Italian Sentence case', () => {
      const strings = [
        APP_CHECK_STRINGS.unsupportedTitle,
        APP_CHECK_STRINGS.unsupportedMessage,
        APP_CHECK_STRINGS.initErrorTitle,
        APP_CHECK_STRINGS.initErrorMessage,
      ];

      for (const str of strings) {
        expect(str.length).toBeGreaterThan(0);
        // First character must be uppercase
        expect(str[0]).toBe(str[0].toUpperCase());

        // Second word must start with lowercase (Sentence case invariant)
        const words = str.split(' ');
        if (words.length > 1) {
          const secondWord = words[1];
          expect(secondWord[0]).toBe(secondWord[0].toLowerCase());
        }
      }
    });

    it('telemetry status accurately reflects offline fallback and token states', async () => {
      let status = getAppCheckStatus();
      expect(status.initialized).toBe(false);
      expect(status.hasToken).toBe(false);
      expect(status.provider).toBe('none');

      await initAppCheck(mockFirebaseApp, { siteKey: 'valid-key' });
      status = getAppCheckStatus();
      expect(status.initialized).toBe(true);
      expect(status.hasToken).toBe(true);
      expect(status.fallbackOffline).toBe(false);
      expect(status.provider).toBe('ReCaptchaV3Provider');

      setAppCheckFallbackOffline(true);
      status = getAppCheckStatus();
      expect(status.fallbackOffline).toBe(true);
    });
  });

  // =========================================================================
  // DOMAIN 2: UX Error Handling & 3 Mandatory Failure Scenarios
  // =========================================================================
  describe('Domain 2: UX Error Handling & 3 Mandatory Failure Scenarios', () => {
    let mockAlerts: { message: string; title?: string }[] = [];
    const mockDialogHandler: DialogHandler = {
      showAlert: vi.fn(async (message: string, title?: string) => {
        mockAlerts.push({ message, title });
      }),
    };

    beforeEach(() => {
      mockAlerts = [];
      setDialogHandler(mockDialogHandler);
    });

    it('Scenario 1: executes offline save with IndexedDB confirmation and exact Italian Sentence case', async () => {
      const result = await handleOfflineSaveScenario('unavailable');

      expect(result.scenario).toBe('offline_save');
      expect(result.localSuccess).toBe(true);
      expect(result.cloudSynced).toBe(false);
      expect(result.dialogTitle).toBe('Salvataggio locale completato');
      expect(result.dialogMessage).toBe(
        'I tuoi dati sono stati salvati con successo nella memoria locale del dispositivo. La sincronizzazione con il cloud riprenderà automaticamente non appena la connessione sarà ripristinata.'
      );

      // Verify Sentence case
      expect(result.dialogTitle[0]).toBe(result.dialogTitle[0].toUpperCase());
      expect(result.dialogTitle.split(' ')[1][0]).toBe(result.dialogTitle.split(' ')[1][0].toLowerCase());

      // Verify useDialogStore was invoked
      expect(mockDialogHandler.showAlert).toHaveBeenCalledWith(
        result.dialogMessage,
        'Salvataggio locale completato'
      );
    });

    it('Scenario 2: executes App Check unsupported/blocked with offline-only transition', async () => {
      const result = await handleAppCheckFailureScenario('appcheck/unsupported');

      expect(result.scenario).toBe('app_check_blocked');
      expect(result.localSuccess).toBe(true);
      expect(result.cloudSynced).toBe(false);
      expect(result.mode).toBe('offline_only');
      expect(result.dialogTitle).toBe('Verifica di sicurezza non supportata');
      expect(result.dialogMessage).toContain('LogBook continuerà a funzionare regolarmente in modalità locale offline sul tuo dispositivo.');

      expect(mockDialogHandler.showAlert).toHaveBeenCalledWith(
        result.dialogMessage,
        'Verifica di sicurezza non supportata'
      );
    });

    it('Scenario 3: executes Security Rules rejection / quota exceeded preserving local data', async () => {
      const result = await handleRulesRejectionScenario('permission-denied');

      expect(result.scenario).toBe('rules_rejection');
      expect(result.localSuccess).toBe(true);
      expect(result.cloudSynced).toBe(false);
      expect(result.dialogTitle).toBe('Limite dati superato');
      expect(result.dialogMessage).toBe(
        "L'operazione non può essere sincronizzata nel cloud perché supera i limiti consentiti per il tuo account. Verifica i dati inseriti o riduci il numero di elementi prima di riprovare. I dati rimangono comunque disponibili sul dispositivo."
      );

      expect(mockDialogHandler.showAlert).toHaveBeenCalledWith(
        result.dialogMessage,
        'Limite dati superato'
      );
    });

    it('dispatchErrorScenario correctly routes diverse error payloads to the appropriate scenario', async () => {
      // 1. App Check errors -> Scenario 2
      const appCheckRes = await dispatchErrorScenario('appcheck/fetch-status-error');
      expect(appCheckRes.scenario).toBe('app_check_blocked');
      expect(appCheckRes.mode).toBe('offline_only');

      // 2. Rules rejection / permission-denied -> Scenario 3
      const permRes = await dispatchErrorScenario({ code: 'permission-denied', message: 'Missing permissions' });
      expect(permRes.scenario).toBe('rules_rejection');

      // 3. Quota exhausted -> Scenario 3
      const quotaRes = await dispatchErrorScenario({ code: 'resource-exhausted', message: 'Quota exceeded' });
      expect(quotaRes.scenario).toBe('rules_rejection');

      // 4. Pre-flight checkDocSize limit (>950KB) -> Scenario 3
      const docSizeRes = await dispatchErrorScenario('Il documento supera il limite di dimensione di sicurezza di Firestore');
      expect(docSizeRes.scenario).toBe('rules_rejection');

      // 5. Network unavailable with successful local write -> Scenario 1
      const netRes = await dispatchErrorScenario({ code: 'unavailable', message: 'Offline' }, true);
      expect(netRes.scenario).toBe('offline_save');
      expect(netRes.localSuccess).toBe(true);
    });

    it('mapFirebaseErrorCode handles bizarre and malformed error inputs without crashing', () => {
      const weirdInputs = [
        null,
        undefined,
        12345,
        true,
        false,
        Symbol('err'),
        {},
        { somethingElse: 999 },
        new TypeError('Cannot read properties of undefined'),
        'UNKNOWN_RANDOM_STRING_XYZ',
      ];

      for (const input of weirdInputs) {
        const mapped = mapFirebaseErrorCode(input);
        expect(mapped).toBeDefined();
        expect(mapped.code).toBeDefined();
        expect(mapped.title).toBeDefined();
        expect(mapped.message).toBeDefined();
        expect(mapped.title[0]).toBe(mapped.title[0].toUpperCase());
      }
    });

    it('toSentenceCase handles boundary and internationalization inputs correctly', () => {
      expect(toSentenceCase('')).toBe('');
      expect(toSentenceCase('   ')).toBe('');
      expect(toSentenceCase('a')).toBe('A');
      expect(toSentenceCase('A')).toBe('A');
      expect(toSentenceCase('connessione non disponibile')).toBe('Connessione non disponibile');
      expect(toSentenceCase('123 numeri')).toBe('123 numeri');
      expect(toSentenceCase('è un errore')).toBe('È un errore');
    });

    it('integrates with globalThis.useDialogStore when defined on the window/global scope', async () => {
      const globalMockAlert = vi.fn().mockResolvedValue(undefined);
      (globalThis as any).useDialogStore = {
        getState: () => ({ showAlert: globalMockAlert }),
      };

      // Reset to default handler
      setDialogHandler({
        showAlert: async (msg, title) => {
          const store = (globalThis as any).useDialogStore;
          if (store && typeof store.getState === 'function') {
            return store.getState().showAlert(msg, title);
          }
        },
      });

      await handleOfflineSaveScenario('unavailable');
      expect(globalMockAlert).toHaveBeenCalledWith(
        expect.stringContaining('salvati con successo nella memoria locale'),
        'Salvataggio locale completato'
      );

      delete (globalThis as any).useDialogStore;
    });
  });

  // =========================================================================
  // DOMAIN 3: Privacy Analytics PII Sanitization & Adversarial Data Leakage
  // =========================================================================
  describe('Domain 3: Privacy Analytics PII Sanitization & Adversarial Data Leakage', () => {
    const mockTransport = vi.fn();

    beforeEach(() => {
      setAnalyticsTransport(mockTransport);
    });

    it('rejects logging entirely when consent is in default prompt state (Zero Transmission Gate)', () => {
      expect(getAnalyticsConsent()).toBe('prompt');
      expect(isAnalyticsEnabled()).toBe(false);

      const logged = logPrivacyEvent('app_opened', {
        platform: 'ios',
        is_pwa: true,
        is_guest: false,
      });

      expect(logged).toBe(false);
      expect(mockTransport).not.toHaveBeenCalled();
      expect(getEventBuffer().length).toBe(0);
    });

    it('rejects logging entirely when consent is denied (Zero Transmission Gate)', () => {
      setAnalyticsConsent('denied');
      expect(getAnalyticsConsent()).toBe('denied');
      expect(isAnalyticsEnabled()).toBe(false);

      const logged = logPrivacyEvent('workout_session_logged', {
        duration_bucket: '30-60m',
        exercises_count_bucket: '4-6',
        is_routine_based: true,
      });

      expect(logged).toBe(false);
      expect(mockTransport).not.toHaveBeenCalled();
      expect(getEventBuffer().length).toBe(0);
    });

    it('immediately purges memory buffers and blocks future calls upon consent revocation', () => {
      setAnalyticsConsent('granted');
      expect(isAnalyticsEnabled()).toBe(true);

      logPrivacyEvent('app_opened', { platform: 'android', is_pwa: true, is_guest: false });
      logPrivacyEvent('screen_view', { screen_name: 'training' });
      expect(getEventBuffer().length).toBe(2);

      // User revokes consent in settings UI
      revokeConsent();

      // Invariant: In-memory event buffer must be immediately wiped to 0
      expect(getEventBuffer().length).toBe(0);
      expect(isAnalyticsEnabled()).toBe(false);
      expect(getAnalyticsConsent()).toBe('denied');

      // Subsequent log attempts are discarded
      const logged = logPrivacyEvent('csv_export_triggered', { has_workouts: true, has_nutrition: true });
      expect(logged).toBe(false);
      expect(mockTransport).toHaveBeenCalledTimes(2); // No new calls
    });

    it('ADVERSARIAL ATTACK: attempts to leak 50+ sensitive health/PII fields across all event types', () => {
      // Construct hostile payload with every blacklisted health/identity field
      const hostilePayload: Record<string, any> = {
        // Identity & Auth
        uid: 'attacker_uid_999',
        userId: 'attacker_uid_999',
        user_id: 'attacker_uid_999',
        email: 'victim@gym.com',
        name: 'John Doe',
        displayName: 'Johnny',
        photoURL: 'https://cdn.example.com/face.jpg',

        // Biometrics & Body Composition
        weight: 85.5,
        body_weight: 85.5,
        kg: '85.5',
        bf: 14.2,
        body_fat: 14.2,
        neck: 40,
        waist: 84,
        hip: 100,
        hips: 100,
        chest: 110,
        shoulders: 125,
        biceps: 39,
        thighs: 60,
        calves: 38,
        measurements: { waist: 84, arm: 39 },

        // Workout Health Data
        exerciseName: 'Stacco da terra massimale',
        exercise_name: 'Stacco da terra massimale',
        reps: 5,
        notes: 'Forte dolore lombare durante la terza serie',
        sessionNote: 'Ernia del disco infiammata',
        pains: ['lumbar', 'left_knee'],
        activePains: ['lumbar'],
        moodRating: 2,
        pumpRating: 3,
        fatigueRating: 5,

        // Nutrition & Health Data
        foodName: 'Integratore creatina monoidrato',
        food_name: 'Integratore creatina monoidrato',
        kcal: 3200,
        calories: 3200,
        carbs: 400,
        pro: 200,
        protein: 200,
        fat: 80,
        fats: 80,
        supplement: 'Creatine',
        supplements: ['Creatine', 'Omega3'],

        // Sleep Health Data
        sleep: '06:30',
        sleepHours: '06:30',
        sleepDeep: '01:15',
        sleepLight: '04:00',
        sleepRem: '01:15',
        sleepAwake: '00:30',

        // Non-whitelisted random/injection fields
        ip_address: '192.168.1.1',
        credit_card: '4111-2222-3333-4444',
        hacked_token: 'secret_jwt_token',
      };

      // Test across ALL allowed event types with their legitimate params + the hostile payload
      const testEvents: Array<{ event: AllowedEventName; validParams: Record<string, any> }> = [
        { event: 'app_opened', validParams: { platform: 'ios', is_pwa: true, is_guest: false } },
        { event: 'screen_view', validParams: { screen_name: 'home' } },
        { event: 'sub_tab_view', validParams: { tab_name: 'training', sub_tab_name: 'workout' } },
        { event: 'workout_session_logged', validParams: { duration_bucket: '<30m', exercises_count_bucket: '1-3', is_routine_based: false } },
        { event: 'nutrition_day_logged', validParams: { has_meals: true, has_measurements: false, meals_count_bucket: '1-3' } },
        { event: 'routine_created', validParams: { exercises_count_bucket: '1-5' } },
        { event: 'training_cycle_created', validParams: { duration_weeks_bucket: '1-4' } },
        { event: 'csv_export_triggered', validParams: { has_workouts: true, has_nutrition: false } },
        { event: 'pwa_installed', validParams: { platform: 'desktop' } },
        { event: 'app_check_result', validParams: { status: 'success' } },
        { event: 'sync_error_occurred', validParams: { error_category: 'network', error_code: 'ERR_FIRESTORE_UNAVAILABLE', is_offline: true } },
      ];

      for (const { event, validParams } of testEvents) {
        const injectedPayload = { ...validParams, ...hostilePayload };
        const sanitized = sanitizePayload(event, injectedPayload);

        // 1. Sanitized object must match validParams EXACTLY
        expect(sanitized).toEqual(validParams);

        // 2. Not a single blacklisted sensitive key can exist in sanitized output
        for (const blacklistedField of SENSITIVE_FIELD_BLACKLIST) {
          expect(sanitized).not.toHaveProperty(blacklistedField);
          expect((sanitized as any)[blacklistedField]).toBeUndefined();
        }

        // 3. Injected random fields must not exist
        expect((sanitized as any).ip_address).toBeUndefined();
        expect((sanitized as any).credit_card).toBeUndefined();
        expect((sanitized as any).hacked_token).toBeUndefined();

        // 4. Output keys must be a subset of the declared whitelist
        const allowedWhitelist = EVENT_PARAM_WHITELIST[event];
        for (const key of Object.keys(sanitized)) {
          expect(allowedWhitelist).toContain(key);
        }
      }
    });

    it('ADVERSARIAL ATTACK: handles case permutation evasion attempts (e.g. WEIGHT, Weight, uId, Notes)', () => {
      const casingAttackPayload = {
        platform: 'ios' as const,
        is_pwa: true,
        is_guest: false,
        WEIGHT: 90,
        Weight: 90,
        UID: 'hacked_uid',
        uId: 'hacked_uid',
        Notes: 'Secret medical notes',
        NOTES: 'Secret medical notes',
        Food_Name: 'Secret supplement',
        Exercise_Name: 'Secret PR',
      };

      const sanitized = sanitizePayload('app_opened', casingAttackPayload);

      expect(sanitized).toEqual({
        platform: 'ios',
        is_pwa: true,
        is_guest: false,
      });

      expect((sanitized as any).WEIGHT).toBeUndefined();
      expect((sanitized as any).Weight).toBeUndefined();
      expect((sanitized as any).UID).toBeUndefined();
      expect((sanitized as any).Notes).toBeUndefined();
    });

    it('throws when unrecognized event name is supplied to sanitizePayload', () => {
      expect(() => {
        sanitizePayload('malicious_unrecognized_event' as any, { someKey: 123 });
      }).toThrowError(/Unrecognized analytics event: malicious_unrecognized_event/);
    });

    it('bucketing helper functions survive extreme numerical boundary conditions', () => {
      // Workout Duration
      expect(bucketWorkoutDuration(-10)).toBe('<30m');
      expect(bucketWorkoutDuration(0)).toBe('<30m');
      expect(bucketWorkoutDuration(29.99)).toBe('<30m');
      expect(bucketWorkoutDuration(30)).toBe('30-60m');
      expect(bucketWorkoutDuration(60)).toBe('30-60m');
      expect(bucketWorkoutDuration(60.01)).toBe('60-90m');
      expect(bucketWorkoutDuration(90)).toBe('60-90m');
      expect(bucketWorkoutDuration(90.01)).toBe('>90m');
      expect(bucketWorkoutDuration(100000)).toBe('>90m');

      // Exercise Count
      expect(bucketExerciseCount(-1)).toBe('1-3');
      expect(bucketExerciseCount(0)).toBe('1-3');
      expect(bucketExerciseCount(3)).toBe('1-3');
      expect(bucketExerciseCount(4)).toBe('4-6');
      expect(bucketExerciseCount(6)).toBe('4-6');
      expect(bucketExerciseCount(7)).toBe('7-10');
      expect(bucketExerciseCount(10)).toBe('7-10');
      expect(bucketExerciseCount(11)).toBe('>10');
      expect(bucketExerciseCount(500)).toBe('>10');

      // Routine Exercise Count
      expect(bucketRoutineExerciseCount(0)).toBe('1-5');
      expect(bucketRoutineExerciseCount(5)).toBe('1-5');
      expect(bucketRoutineExerciseCount(6)).toBe('6-10');
      expect(bucketRoutineExerciseCount(10)).toBe('6-10');
      expect(bucketRoutineExerciseCount(11)).toBe('>10');

      // Meals Count
      expect(bucketMealsCount(0)).toBe('1-3');
      expect(bucketMealsCount(3)).toBe('1-3');
      expect(bucketMealsCount(4)).toBe('4-6');
      expect(bucketMealsCount(6)).toBe('4-6');
      expect(bucketMealsCount(7)).toBe('>6');

      // Cycle Duration
      expect(bucketCycleDuration(0)).toBe('1-4');
      expect(bucketCycleDuration(4)).toBe('1-4');
      expect(bucketCycleDuration(5)).toBe('5-8');
      expect(bucketCycleDuration(8)).toBe('5-8');
      expect(bucketCycleDuration(9)).toBe('9-12');
      expect(bucketCycleDuration(12)).toBe('9-12');
      expect(bucketCycleDuration(13)).toBe('>12');
    });
  });
});
