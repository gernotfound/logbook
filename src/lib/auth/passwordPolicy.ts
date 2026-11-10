import { auth, validatePassword } from '../firebase';

export const PASSWORD_POLICY_SUMMARY =
    'La password non rispetta i requisiti di sicurezza configurati per l’account.';

// NIST SP 800-63B-4: 15 Unicode code points for single-factor passwords.
// Firebase is authoritative for additional requirements until the server cutover.
export const MIN_NEW_PASSWORD_LENGTH = 15;

export type PasswordRuleConfig = {
    minPasswordLength?: number;
    maxPasswordLength?: number;
    containsLowercaseLetter?: boolean;
    containsUppercaseLetter?: boolean;
    containsNumericCharacter?: boolean;
    containsNonAlphanumericCharacter?: boolean;
};

function passwordLength(password: string): number {
    return Array.from(password).length;
}

function policyUnavailable(cause?: unknown): Error & { code: string } {
    return Object.assign(new Error('Verifica della policy password non disponibile.', { cause }), {
        code: 'auth/password-policy-unavailable',
    });
}

export async function loadPasswordRuleConfig(): Promise<PasswordRuleConfig> {
    const status = await validatePassword(auth, '');
    // These rules drive hints only. Submission always revalidates with Firebase.
    return status.passwordPolicy?.customStrengthOptions ?? {};
}

export function getPasswordRequirements(password: string, rules: PasswordRuleConfig = {}): { label: string; met: boolean }[] {
    const length = passwordLength(password);
    const minLength = Math.max(MIN_NEW_PASSWORD_LENGTH, rules.minPasswordLength ?? 0);
    const requirements = [
        { label: `Almeno ${minLength} caratteri`, met: length >= minLength },
    ];
    if (rules.maxPasswordLength !== undefined) {
        requirements.push({ label: `Massimo ${rules.maxPasswordLength} caratteri`, met: length <= rules.maxPasswordLength });
    }
    // Composition checks are only advisory when explicitly required by Firebase.
    // They are not local blockers: the provider validates its own Unicode semantics.
    if (rules.containsLowercaseLetter === true) requirements.push({ label: 'Una lettera minuscola', met: /[a-z]/.test(password) });
    if (rules.containsUppercaseLetter === true) requirements.push({ label: 'Una lettera maiuscola', met: /[A-Z]/.test(password) });
    if (rules.containsNumericCharacter === true) requirements.push({ label: 'Un numero', met: /[0-9]/.test(password) });
    if (rules.containsNonAlphanumericCharacter === true) requirements.push({ label: 'Un carattere speciale', met: /[^a-zA-Z0-9]/.test(password) });
    return requirements;
}

export async function validatePasswordAgainstPolicy(password: string): Promise<string | null> {
    const baselineFailure = getPasswordRequirements(password).find(rule => !rule.met);
    if (baselineFailure) return `La password richiede: ${baselineFailure.label.toLowerCase()}.`;

    let status: Awaited<ReturnType<typeof validatePassword>>;
    try {
        status = await validatePassword(auth, password);
    } catch (cause) {
        throw policyUnavailable(cause);
    }
    if (!status || typeof status.isValid !== 'boolean') throw policyUnavailable();
    if (status.isValid) return null;

    const rules = status.passwordPolicy?.customStrengthOptions;
    if (status.meetsMinPasswordLength === false && rules?.minPasswordLength) {
        return `La password deve contenere almeno ${Math.max(MIN_NEW_PASSWORD_LENGTH, rules.minPasswordLength)} caratteri.`;
    }
    if (status.meetsMaxPasswordLength === false && rules?.maxPasswordLength) {
        return `La password non può superare ${rules.maxPasswordLength} caratteri.`;
    }
    if (rules?.containsNumericCharacter === true && status.containsNumericCharacter === false) {
        return 'Firebase richiede ancora almeno 1 numero per questa password.';
    }
    if (rules?.containsLowercaseLetter === true && status.containsLowercaseLetter === false) {
        return 'Firebase richiede ancora almeno 1 lettera minuscola per questa password.';
    }
    if (rules?.containsUppercaseLetter === true && status.containsUppercaseLetter === false) {
        return 'Firebase richiede ancora almeno 1 lettera maiuscola per questa password.';
    }
    if (rules?.containsNonAlphanumericCharacter === true && status.containsNonAlphanumericCharacter === false) {
        return 'Firebase richiede ancora almeno 1 carattere speciale per questa password.';
    }
    return PASSWORD_POLICY_SUMMARY;
}
