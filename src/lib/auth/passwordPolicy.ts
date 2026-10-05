import { auth, validatePassword } from '../firebase';

export const PASSWORD_POLICY_SUMMARY =
    'La password non rispetta i requisiti di sicurezza configurati per l’account.';

export async function validatePasswordAgainstPolicy(password: string): Promise<string | null> {
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
