import { auth, validatePassword } from '../firebase';

export const PASSWORD_POLICY_SUMMARY =
    'La password non rispetta i requisiti di sicurezza configurati per l’account.';

const MIN_PASSWORD_LENGTH = 12;

const LOCAL_PASSWORD_RULES = [
    { label: 'Almeno 12 caratteri', test: (password: string) => password.length >= MIN_PASSWORD_LENGTH },
    { label: 'Una lettera minuscola', test: (password: string) => /[a-z]/.test(password) },
    { label: 'Una lettera maiuscola', test: (password: string) => /[A-Z]/.test(password) },
    { label: 'Un numero', test: (password: string) => /[0-9]/.test(password) },
    { label: 'Un carattere speciale', test: (password: string) => /[^a-zA-Z0-9]/.test(password) },
] as const;

export function getPasswordRequirements(password: string): { label: string; met: boolean }[] {
    return LOCAL_PASSWORD_RULES.map(rule => ({ label: rule.label, met: rule.test(password) }));
}

export function getPasswordBaselineError(password: string): string | null {
    const missing = getPasswordRequirements(password).find(rule => !rule.met);
    return missing ? `La password richiede: ${missing.label.toLowerCase()}.` : null;
}

export async function validatePasswordAgainstPolicy(password: string): Promise<string | null> {
    const baselineError = getPasswordBaselineError(password);
    if (baselineError) return baselineError;

    // Firebase may enforce additional, stricter requirements configured remotely.
    const status = await validatePassword(auth, password);
    if (status.isValid) return null;

    const policy = status.passwordPolicy.customStrengthOptions;
    if (status.meetsMinPasswordLength === false) {
        return `La password deve contenere almeno ${policy.minPasswordLength ?? 6} caratteri.`;
    }
    if (status.meetsMaxPasswordLength === false) {
        return `La password non può superare ${policy.maxPasswordLength ?? 4096} caratteri.`;
    }
    if (status.containsNumericCharacter === false) {
        return 'La password deve contenere almeno 1 numero.';
    }
    if (status.containsLowercaseLetter === false) {
        return 'La password deve contenere almeno 1 lettera minuscola.';
    }
    if (status.containsUppercaseLetter === false) {
        return 'La password deve contenere almeno 1 lettera maiuscola.';
    }
    if (status.containsNonAlphanumericCharacter === false) {
        return 'La password deve contenere almeno 1 carattere speciale.';
    }
    return PASSWORD_POLICY_SUMMARY;
}
