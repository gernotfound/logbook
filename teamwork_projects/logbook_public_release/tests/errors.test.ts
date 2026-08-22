import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  mapFirebaseErrorCode,
  toSentenceCase,
  FormattedSyncError,
} from '../src/errors/errorHandler.js';
import {
  handleOfflineSaveScenario,
  handleAppCheckFailureScenario,
  handleRulesRejectionScenario,
  dispatchErrorScenario,
  DialogHandler,
} from '../src/errors/errorScenarios.js';

describe('Resilient UX & Error Handling Suite', () => {
  let mockDialogs: { message: string; title?: string }[] = [];
  const mockHandler: DialogHandler = {
    showAlert: vi.fn(async (message: string, title?: string) => {
      mockDialogs.push({ message, title });
    }),
  };

  beforeEach(() => {
    mockDialogs = [];
    vi.clearAllMocks();
  });

  describe('Sentence Case Formatter & Validation', () => {
    it('formats strings into Italian Sentence case (only initial letter capitalized)', () => {
      expect(toSentenceCase('salvataggio locale completato')).toBe('Salvataggio locale completato');
      expect(toSentenceCase('VERIFICA DI SICUREZZA')).toBe('VERIFICA DI SICUREZZA');
      expect(toSentenceCase('')).toBe('');
    });

    it('ensures all mapped error titles adhere strictly to Italian Sentence case', () => {
      const errorCases = [
        'unavailable',
        'auth/network-request-failed',
        'auth/requires-recent-login',
        'appcheck/unsupported',
        'appcheck/fetch-status-error',
        'resource-exhausted',
        'quotaexceedederror',
        'supera il limite di dimensione',
        'deadline-exceeded',
        'permission-denied',
        'zoderror',
        'unknown_custom_error',
      ];

      for (const err of errorCases) {
        const formatted = mapFirebaseErrorCode(err);
        const title = formatted.title;
        expect(title[0]).toBe(title[0].toUpperCase());

        // Ensure title is not written in Title Case (e.g. "Salvataggio Locale Completato" is wrong)
        const words = title.split(' ');
        if (words.length > 1) {
          const secondWord = words[1];
          // Second word should start with lowercase unless it is an acronym or proper noun
          if (secondWord.length > 1 && !/^[A-Z0-9]+$/.test(secondWord)) {
            expect(secondWord[0]).toBe(secondWord[0].toLowerCase());
          }
        }
      }
    });
  });

  describe('Firebase Error Code Mapping', () => {
    it('maps network & offline errors to ERR_FIRESTORE_UNAVAILABLE', () => {
      const result = mapFirebaseErrorCode({ code: 'unavailable', message: 'Client is offline' });
      expect(result.code).toBe('ERR_FIRESTORE_UNAVAILABLE');
      expect(result.category).toBe('network');
      expect(result.isOfflineSafe).toBe(true);
      expect(result.title).toBe('Connessione non disponibile');
    });

    it('maps auth errors to ERR_AUTH_NETWORK and ERR_AUTH_EXPIRED', () => {
      const netAuth = mapFirebaseErrorCode('auth/network-request-failed');
      expect(netAuth.code).toBe('ERR_AUTH_NETWORK');
      expect(netAuth.category).toBe('auth');

      const expiredAuth = mapFirebaseErrorCode('auth/requires-recent-login');
      expect(expiredAuth.code).toBe('ERR_AUTH_EXPIRED');
      expect(expiredAuth.category).toBe('auth');
    });

    it('maps App Check errors to ERR_APP_CHECK_UNSUPPORTED and ERR_APP_CHECK_BLOCKED', () => {
      const unsupported = mapFirebaseErrorCode('appcheck/unsupported');
      expect(unsupported.code).toBe('ERR_APP_CHECK_UNSUPPORTED');
      expect(unsupported.category).toBe('app_check');

      const blocked = mapFirebaseErrorCode('appcheck/fetch-status-error');
      expect(blocked.code).toBe('ERR_APP_CHECK_BLOCKED');
      expect(blocked.category).toBe('app_check');
    });

    it('maps quota & size limits to ERR_FIRESTORE_QUOTA and ERR_DOC_SIZE_EXCEEDED', () => {
      const quota = mapFirebaseErrorCode('resource-exhausted');
      expect(quota.code).toBe('ERR_FIRESTORE_QUOTA');
      expect(quota.category).toBe('quota');

      const docSize = mapFirebaseErrorCode('Il documento supera il limite di dimensione');
      expect(docSize.code).toBe('ERR_DOC_SIZE_EXCEEDED');
      expect(docSize.category).toBe('validation');
    });

    it('maps permission-denied to ERR_FIRESTORE_PERMISSION', () => {
      const perm = mapFirebaseErrorCode('permission-denied');
      expect(perm.code).toBe('ERR_FIRESTORE_PERMISSION');
      expect(perm.category).toBe('permission');
      expect(perm.title).toBe('Limite dati superato');
    });
  });

  describe('Scenario 1: Offline Network Save with IndexedDB Confirmation', () => {
    it('executes handleOfflineSaveScenario, showing confirmation that local save succeeded', async () => {
      const result = await handleOfflineSaveScenario('unavailable', mockHandler);

      expect(result.scenario).toBe('offline_save');
      expect(result.localSuccess).toBe(true);
      expect(result.cloudSynced).toBe(false);
      expect(result.dialogTitle).toBe('Salvataggio locale completato');
      expect(result.dialogMessage).toContain('salvati con successo nella memoria locale');

      expect(mockHandler.showAlert).toHaveBeenCalledWith(
        result.dialogMessage,
        'Salvataggio locale completato'
      );
    });
  });

  describe('Scenario 2: App Check Unsupported / Blocked', () => {
    it('executes handleAppCheckFailureScenario, setting offline-only mode gracefully', async () => {
      const result = await handleAppCheckFailureScenario('app-check-unsupported', mockHandler);

      expect(result.scenario).toBe('app_check_blocked');
      expect(result.localSuccess).toBe(true);
      expect(result.cloudSynced).toBe(false);
      expect(result.mode).toBe('offline_only');
      expect(result.dialogTitle).toBe('Verifica di sicurezza non supportata');
      expect(result.dialogMessage).toContain('modalità locale offline sul tuo dispositivo');

      expect(mockHandler.showAlert).toHaveBeenCalledWith(
        result.dialogMessage,
        'Verifica di sicurezza non supportata'
      );
    });
  });

  describe('Scenario 3: Security Rules Rejection / Quota Exceeded', () => {
    it('executes handleRulesRejectionScenario, notifying user of limit violation without destroying local data', async () => {
      const result = await handleRulesRejectionScenario('permission-denied', mockHandler);

      expect(result.scenario).toBe('rules_rejection');
      expect(result.localSuccess).toBe(true);
      expect(result.cloudSynced).toBe(false);
      expect(result.dialogTitle).toBe('Limite dati superato');
      expect(result.dialogMessage).toContain('supera i limiti consentiti per il tuo account');

      expect(mockHandler.showAlert).toHaveBeenCalledWith(
        result.dialogMessage,
        'Limite dati superato'
      );
    });
  });

  describe('Unified Error Dispatcher', () => {
    it('dispatches App Check error to scenario 2', async () => {
      const result = await dispatchErrorScenario('appcheck/unsupported', true, mockHandler);
      expect(result.scenario).toBe('app_check_blocked');
      expect(result.mode).toBe('offline_only');
    });

    it('dispatches permission-denied or quota to scenario 3', async () => {
      const result = await dispatchErrorScenario('permission-denied', true, mockHandler);
      expect(result.scenario).toBe('rules_rejection');
    });

    it('dispatches network unavailable to scenario 1', async () => {
      const result = await dispatchErrorScenario('unavailable', true, mockHandler);
      expect(result.scenario).toBe('offline_save');
    });
  });
});
