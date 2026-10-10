import { auth, validatePassword } from '../firebase';

export const PASSWORD_POLICY_SUMMARY =
    'La password non rispetta i requisiti di sicurezza configurati per l’account.';

export type PasswordRuleConfig = {
    minPasswordLength?: number;
    maxPasswordLength?: number;
    containsLowercaseLetter?: boolean;
    containsUppercaseLetter?: boolean;
    containsNumericCharacter?: boolean;
    containsNonAlphanumericCharacter?: boolean;
};

// Stable minimum aligned with the documented Production policy. A remote policy
// may add stricter limits, but cannot silently weaken the application's baseline.
const FALLBACK_RULES: PasswordRuleConfig = {
    minPasswordLength: 8,
    containsLowercaseLetter: true,
    containsUppercaseLetter: true,
    containsNumericCharacter: true,
    containsNonAlphanumericCharacter: true,
};

export async function loadPasswordRuleConfig(): Promise<PasswordRuleConfig> {
    const status = await validatePassword(auth, '');
    return status.passwordPolicy?.customStrengthOptions ?? FALLBACK_RULES;
}

export function getPasswordRequirements(password: string, rules: PasswordRuleConfig = FALLBACK_RULES): { label: string; met: boolean }[] {
    const minLength = Math.max(FALLBACK_RULES.minPasswordLength ?? 8, rules.minPasswordLength ?? 0);
    const requirements = [
        { label: `Almeno ${minLength} caratteri`, met: password.length >= minLength },
    ];
    requirements.push({ label: 'Una lettera minuscola', met: /[a-z]/.test(password) });
    requirements.push({ label: 'Una lettera maiuscola', met: /[A-Z]/.test(password) });
    requirements.push({ label: 'Un numero', met: /[0-9]/.test(password) });
    requirements.push({ label: 'Un carattere speciale', met: /[^a-zA-Z0-9]/.test(password) });
    if (rules.maxPasswordLength && password.length > rules.maxPasswordLength) {
        requirements.push({ label: `Massimo ${rules.maxPasswordLength} caratteri`, met: false });
    }
    return requirements;
}

export async function validatePasswordAgainstPolicy(password: string): Promise<string | null> {
    const baselineFailure = getPasswordRequirements(password).find(rule => !rule.met);
    if (baselineFailure) return `La password richiede: ${baselineFailure.label.toLowerCase()}.`;

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
