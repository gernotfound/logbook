/**
 * LogBook - Error Handler & Firebase Code Mapper
 * Conforms to Italian Sentence case and AGENTS.md guidelines.
 */

import { telemetryHub } from './telemetryHub';

export type ErrorCategory =
  | 'network'
  | 'auth'
  | 'quota'
  | 'permission'
  | 'app_check'
  | 'storage'
  | 'validation'
  | 'timeout'
  | 'unknown';

export type NormalizedErrorCode =
  | 'ERR_AUTH_NETWORK'
  | 'ERR_AUTH_EXPIRED'
  | 'ERR_FIRESTORE_UNAVAILABLE'
  | 'ERR_FIRESTORE_QUOTA'
  | 'ERR_FIRESTORE_PERMISSION'
  | 'ERR_FIRESTORE_TIMEOUT'
  | 'ERR_APP_CHECK_UNSUPPORTED'
  | 'ERR_APP_CHECK_BLOCKED'
  | 'ERR_STORAGE_QUOTA_EXCEEDED'
  | 'ERR_DOC_SIZE_EXCEEDED'
  | 'ERR_SCHEMA_VALIDATION_FALLBACK'
  | 'ERR_UNKNOWN';

export interface FormattedSyncError {
  code: NormalizedErrorCode;
  rawCode?: string;
  category: ErrorCategory;
  title: string;
  message: string;
  isOfflineSafe: boolean;
  canRetry: boolean;
}

/**
 * Utility to ensure strict Italian Sentence case formatting.
 * Capitalizes only the first letter of the first word, preserving acronyms and lowercase for subsequent words.
 */
export function toSentenceCase(str: string): string {
  if (!str || str.length === 0) return '';
  const trimmed = str.trim();
  if (trimmed.length === 0) return '';
  return trimmed.charAt(0).toUpperCase() + trimmed.slice(1);
}

/**
 * Maps raw Firebase error strings, error codes or exception objects
 * to structured, privacy-safe error objects in Italian Sentence case.
 */
export function mapFirebaseErrorCode(error: unknown): FormattedSyncError {
  let rawCode = '';
  let rawMessage = '';

  if (typeof error === 'string') {
    rawCode = error;
    rawMessage = error;
  } else if (error && typeof error === 'object') {
    const errObj = error as Record<string, any>;
    rawCode = String(errObj.code || errObj.name || '');
    rawMessage = String(errObj.message || '');
  }

  const combined = `${rawCode} ${rawMessage}`.toLowerCase();

  // 1. Auth network error (must precede generic network check)
  if (
    combined.includes('auth/network-request-failed') ||
    combined.includes('err_auth_network')
  ) {
    return {
      code: 'ERR_AUTH_NETWORK',
      rawCode,
      category: 'auth',
      title: 'Errore di connessione',
      message:
        'Impossibile contattare i server di autenticazione. Verifica la connessione a internet e riprova.',
      isOfflineSafe: true,
      canRetry: true,
    };
  }

  // 2. Auth expired / Requires login
  if (
    combined.includes('unauthenticated') ||
    combined.includes('auth/requires-recent-login') ||
    combined.includes('auth/user-token-expired') ||
    combined.includes('auth/invalid-user-token') ||
    combined.includes('auth/user-not-found') ||
    combined.includes('err_auth_expired')
  ) {
    return {
      code: 'ERR_AUTH_EXPIRED',
      rawCode,
      category: 'auth',
      title: 'Sessione di accesso scaduta',
      message:
        'La tua sessione di accesso è scaduta. Effettua nuovamente il login per continuare a sincronizzare i dati con il cloud.',
      isOfflineSafe: true,
      canRetry: false,
    };
  }

  // 3. App Check unsupported
  if (
    combined.includes('app-check-unsupported') ||
    combined.includes('appcheck/unsupported') ||
    combined.includes('err_app_check_unsupported')
  ) {
    return {
      code: 'ERR_APP_CHECK_UNSUPPORTED',
      rawCode,
      category: 'app_check',
      title: 'Verifica di sicurezza non supportata',
      message:
        'Il browser o la modalità di navigazione attuale non supportano i controlli di sicurezza necessari per la sincronizzazione cloud. LogBook continuerà a funzionare regolarmente in modalità locale offline sul tuo dispositivo.',
      isOfflineSafe: true,
      canRetry: false,
    };
  }

  // 4. App Check blocked / invalid token
  if (
    combined.includes('app-check-blocked') ||
    combined.includes('appcheck/fetch-status-error') ||
    combined.includes('appcheck/invalid-token') ||
    combined.includes('err_app_check_blocked')
  ) {
    return {
      code: 'ERR_APP_CHECK_BLOCKED',
      rawCode,
      category: 'app_check',
      title: 'Verifica di sicurezza non superata',
      message:
        'La verifica di integrità di sicurezza non è andata a buon fine. La sincronizzazione con il cloud è stata temporaneamente sospesa. I dati rimangono al sicuro sul dispositivo.',
      isOfflineSafe: true,
      canRetry: true,
    };
  }

  // 5. Quota / Resource exhausted
  if (
    combined.includes('resource-exhausted') ||
    combined.includes('quota-exceeded') ||
    combined.includes('err_firestore_quota')
  ) {
    return {
      code: 'ERR_FIRESTORE_QUOTA',
      rawCode,
      category: 'quota',
      title: 'Limite di sincronizzazione raggiunto',
      message:
        'È stato raggiunto il limite temporaneo di operazioni consentite per il servizio gratuito. I tuoi dati sono al sicuro sul dispositivo e verranno sincronizzati più tardi.',
      isOfflineSafe: true,
      canRetry: true,
    };
  }

  // 6. Storage Quota Exceeded (IndexedDB / LocalStorage)
  if (
    combined.includes('quotaexceedederror') ||
    combined.includes('ns_error_dom_quota_reached') ||
    combined.includes('err_storage_quota_exceeded')
  ) {
    return {
      code: 'ERR_STORAGE_QUOTA_EXCEEDED',
      rawCode,
      category: 'storage',
      title: 'Spazio di archiviazione esaurito',
      message:
        'Lo spazio di memoria locale sul dispositivo è esaurito. Libera spazio o cancella i dati non necessari per consentire il salvataggio.',
      isOfflineSafe: false,
      canRetry: false,
    };
  }

  // 7. Document size limit (Client pre-flight checkDocSize > 950KB)
  if (
    combined.includes('supera il limite di dimensione') ||
    combined.includes('checkdocsize') ||
    combined.includes('err_doc_size_exceeded')
  ) {
    return {
      code: 'ERR_DOC_SIZE_EXCEEDED',
      rawCode,
      category: 'validation',
      title: 'Dimensione dati eccessiva',
      message:
        'I dati inseriti superano la dimensione massima consentita per singolo salvataggio. Riduci le note o gli elementi salvati prima di procedere.',
      isOfflineSafe: false,
      canRetry: false,
    };
  }

  // 8. Timeout / Deadline exceeded
  if (
    combined.includes('deadline-exceeded') ||
    combined.includes('timeout') ||
    combined.includes('tempo scaduto') ||
    combined.includes('err_firestore_timeout')
  ) {
    return {
      code: 'ERR_FIRESTORE_TIMEOUT',
      rawCode,
      category: 'timeout',
      title: 'Tempo di sincronizzazione scaduto',
      message:
        'La sincronizzazione con il server ha impiegato troppo tempo. I dati sono salvati sul dispositivo e il tentativo verrà ripetuto in seguito.',
      isOfflineSafe: true,
      canRetry: true,
    };
  }

  // 9. Permission denied / Security rules rejection
  if (
    combined.includes('permission-denied') ||
    combined.includes('err_firestore_permission') ||
    combined.includes('insufficient permissions')
  ) {
    return {
      code: 'ERR_FIRESTORE_PERMISSION',
      rawCode,
      category: 'permission',
      title: 'Limite dati superato',
      message:
        'L\'operazione non può essere sincronizzata nel cloud perché supera i limiti consentiti per il tuo account. Verifica i dati inseriti o riduci il numero di elementi prima di riprovare. I dati rimangono comunque disponibili sul dispositivo.',
      isOfflineSafe: true,
      canRetry: false,
    };
  }

  // 10. Generic Network / Offline errors
  if (
    combined.includes('unavailable') ||
    combined.includes('network') ||
    combined.includes('offline') ||
    combined.includes('failed-precondition') ||
    combined.includes('client is offline') ||
    combined.includes('err_firestore_unavailable')
  ) {
    return {
      code: 'ERR_FIRESTORE_UNAVAILABLE',
      rawCode,
      category: 'network',
      title: 'Connessione non disponibile',
      message:
        'I dati sono stati salvati con successo sul dispositivo. La sincronizzazione con il cloud riprenderà automaticamente al ripristino della connessione.',
      isOfflineSafe: true,
      canRetry: true,
    };
  }

  // 11. Schema validation fallback
  if (
    combined.includes('zoderror') ||
    combined.includes('validation error') ||
    combined.includes('err_schema_validation_fallback')
  ) {
    return {
      code: 'ERR_SCHEMA_VALIDATION_FALLBACK',
      rawCode,
      category: 'validation',
      title: 'Formato dei dati non valido',
      message:
        'Alcuni dati contengono un formato non supportato. È stato applicato un ripristino sicuro per evitare perdite di informazioni.',
      isOfflineSafe: true,
      canRetry: false,
    };
  }

  // Fallback / Unknown error
  return {
    code: 'ERR_UNKNOWN',
    rawCode,
    category: 'unknown',
    title: 'Errore di sincronizzazione',
    message:
      'Si è verificato un errore imprevisto durante la sincronizzazione cloud. I tuoi dati locali sono preservati.',
    isOfflineSafe: true,
    canRetry: true,
  };
}

/**
 * Non-blocking helper to report errors to the Telemetry Hub without throwing or leaking PII.
 */
export function reportError(
  error: unknown,
  options: { source?: string; customMessage?: string; componentStack?: string } = {}
): void {
  try {
    telemetryHub.trackError(error, options);
  } catch {
    // Non-blocking safe fail-through
  }
}
