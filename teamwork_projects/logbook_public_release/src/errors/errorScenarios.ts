/**
 * LogBook - Resilient UX & Failure Scenarios Handler
 * Conforms to Italian Sentence case and AGENTS.md guidelines.
 * Implements the 3 mandatory failure scenarios:
 * 1) Offline network save with IndexedDB confirmation
 * 2) App Check unsupported / blocked
 * 3) Security Rules rejection / quota exceeded
 */

import { mapFirebaseErrorCode, FormattedSyncError } from './errorHandler.js';

export interface DialogHandler {
  showAlert: (message: string, title?: string) => Promise<void>;
  showConfirm?: (message: string, title?: string) => Promise<boolean>;
}

/**
 * Default dialog store accessor fallback.
 * Checks for global window / useDialogStore if available.
 */
let globalDialogHandler: DialogHandler = {
  showAlert: async (message: string, title = 'Avviso') => {
    // Look up useDialogStore in window or global scope if present
    const store = (globalThis as any).useDialogStore;
    if (store && typeof store.getState === 'function') {
      return store.getState().showAlert(message, title);
    }
    // eslint-disable-next-line no-console
    console.warn(`[DialogAlert: ${title}] ${message}`);
  },
};

/**
 * Allows injecting or configuring custom dialog handlers (e.g. for testing or custom components)
 */
export function setDialogHandler(handler: DialogHandler): void {
  globalDialogHandler = handler;
}

export function getDialogHandler(): DialogHandler {
  return globalDialogHandler;
}

export interface ScenarioResult {
  scenario: 'offline_save' | 'app_check_blocked' | 'rules_rejection';
  localSuccess: boolean;
  cloudSynced: boolean;
  dialogShown: boolean;
  dialogTitle: string;
  dialogMessage: string;
  errorDetails: FormattedSyncError;
  mode?: 'offline_only' | 'standard';
}

/**
 * Scenario 1: Offline Network Save with Local Storage (IndexedDB/LocalStorage) Confirmation
 * Triggered when a cloud save fails due to network unavailability, but local IndexedDB write succeeded.
 */
export async function handleOfflineSaveScenario(
  error?: unknown,
  customHandler?: DialogHandler
): Promise<ScenarioResult> {
  const handler = customHandler || globalDialogHandler;
  const errorDetails = mapFirebaseErrorCode(error || 'unavailable');

  const title = 'Salvataggio locale completato';
  const message =
    'I tuoi dati sono stati salvati con successo nella memoria locale del dispositivo. La sincronizzazione con il cloud riprenderà automaticamente non appena la connessione sarà ripristinata.';

  await handler.showAlert(message, title);

  return {
    scenario: 'offline_save',
    localSuccess: true,
    cloudSynced: false,
    dialogShown: true,
    dialogTitle: title,
    dialogMessage: message,
    errorDetails,
    mode: 'standard',
  };
}

/**
 * Scenario 2: App Check Unsupported or Blocked
 * Triggered when environment does not support reCAPTCHA v3 or attestation fails.
 * Degrades gracefully: disables cloud sync, keeps full local functionality.
 */
export async function handleAppCheckFailureScenario(
  error?: unknown,
  customHandler?: DialogHandler
): Promise<ScenarioResult> {
  const handler = customHandler || globalDialogHandler;
  const errorDetails = mapFirebaseErrorCode(error || 'app-check-unsupported');

  const title = 'Verifica di sicurezza non supportata';
  const message =
    'Il browser o la modalità di navigazione attuale non supportano i controlli di sicurezza necessari per la sincronizzazione cloud. LogBook continuerà a funzionare regolarmente in modalità locale offline sul tuo dispositivo.';

  await handler.showAlert(message, title);

  return {
    scenario: 'app_check_blocked',
    localSuccess: true,
    cloudSynced: false,
    dialogShown: true,
    dialogTitle: title,
    dialogMessage: message,
    errorDetails,
    mode: 'offline_only',
  };
}

/**
 * Scenario 3: Firestore Security Rules Rejection or Quota Exceeded
 * Triggered when a write payload is rejected by server-side rules (e.g. oversized array or fields)
 * or resource quota exceeded. Local data is kept intact and user is informed.
 */
export async function handleRulesRejectionScenario(
  error?: unknown,
  customHandler?: DialogHandler
): Promise<ScenarioResult> {
  const handler = customHandler || globalDialogHandler;
  const errorDetails = mapFirebaseErrorCode(error || 'permission-denied');

  const title = 'Limite dati superato';
  const message =
    'L\'operazione non può essere sincronizzata nel cloud perché supera i limiti consentiti per il tuo account. Verifica i dati inseriti o riduci il numero di elementi prima di riprovare. I dati rimangono comunque disponibili sul dispositivo.';

  await handler.showAlert(message, title);

  return {
    scenario: 'rules_rejection',
    localSuccess: true,
    cloudSynced: false,
    dialogShown: true,
    dialogTitle: title,
    dialogMessage: message,
    errorDetails,
    mode: 'standard',
  };
}

/**
 * Unified error dispatcher that determines which scenario to execute based on error code.
 */
export async function dispatchErrorScenario(
  error: unknown,
  isLocalSaveSuccessful = true,
  customHandler?: DialogHandler
): Promise<ScenarioResult> {
  const formatted = mapFirebaseErrorCode(error);

  if (formatted.category === 'app_check') {
    return handleAppCheckFailureScenario(error, customHandler);
  }

  if (formatted.category === 'permission' || formatted.category === 'quota' || formatted.code === 'ERR_DOC_SIZE_EXCEEDED') {
    return handleRulesRejectionScenario(error, customHandler);
  }

  // Network / timeout / default
  if (isLocalSaveSuccessful) {
    return handleOfflineSaveScenario(error, customHandler);
  }

  const handler = customHandler || globalDialogHandler;
  await handler.showAlert(formatted.message, formatted.title);

  return {
    scenario: 'rules_rejection',
    localSuccess: false,
    cloudSynced: false,
    dialogShown: true,
    dialogTitle: formatted.title,
    dialogMessage: formatted.message,
    errorDetails: formatted,
    mode: 'standard',
  };
}
