import { LegalConsent } from '../types';

/**
 * Versioni correnti dei documenti legali.
 * Incrementa quando aggiorni Privacy Policy o Termini.
 * Gli utenti esistenti vedranno l'overlay di adeguamento se le versioni non corrispondono.
 */
export const LEGAL_VERSIONS = {
  privacy: "1.1.0",
  terms: "1.1.0",
} as const;

export type LegalVersionKey = keyof typeof LEGAL_VERSIONS;

/**
 * Controlla se un utente deve vedere l'overlay di adeguamento
 */
export function needsLegalUpdate(legalConsent: LegalConsent | undefined | null): boolean {
  if (!legalConsent) return true;
  return (
    legalConsent.privacyVersion !== LEGAL_VERSIONS.privacy ||
    legalConsent.termsVersion !== LEGAL_VERSIONS.terms ||
    !legalConsent.hasAcceptedHealthData ||
    !legalConsent.hasAcceptedTerms
  );
}
