export class LegalConsentRequiredError extends Error {
    readonly code = 'legal-consent-required';
    constructor() {
        super('Consenso dell’account necessario prima della sincronizzazione cloud. I dati restano conservati localmente.');
        this.name = 'LegalConsentRequiredError';
    }
}

export const isLegalConsentRequiredError = (error: unknown): error is LegalConsentRequiredError =>
    error instanceof LegalConsentRequiredError || (typeof error === 'object' && error !== null && 'code' in error && error.code === 'legal-consent-required');
