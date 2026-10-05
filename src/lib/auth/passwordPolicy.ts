import { auth, validatePassword } from '../firebase';

export const PASSWORD_POLICY_SUMMARY =
    'La password deve contenere almeno 8 caratteri, con almeno una lettera maiuscola, una minuscola, un numero e un carattere speciale.';

const FIREBASE_NON_ALPHANUMERIC_CHARACTERS = new Set([
    '^', '$', '*', '.', '[', ']', '{', '}', '(', ')', '?', '"', '!', '@', '#',
    '%', '&', '/', '\\', ',', '>', '<', "'", ':', ';', '|', '_', '~', '`',
]);

export function checkPasswordStrength(password: string): string | null {
    if (password.length < 8) return 'La password deve contenere almeno 8 caratteri.';
    if (password.length > 4096) return 'La password è troppo lunga.';
    if (!/\d/.test(password)) return 'La password deve contenere almeno 1 numero.';
    if (!/[a-z]/.test(password)) return 'La password deve contenere almeno 1 lettera minuscola.';
    if (!/[A-Z]/.test(password)) return 'La password deve contenere almeno 1 lettera maiuscola.';
    if (![...password].some(char => FIREBASE_NON_ALPHANUMERIC_CHARACTERS.has(char))) {
        return 'La password deve contenere almeno 1 carattere speciale.';
    }
    return null;
}


export async function validatePasswordAgainstFirebase(password: string): Promise<string | null> {
    try {
        const status = await validatePassword(auth, password);
        if (status.isValid) return null;
        if (status.meetsMinPasswordLength === false) return 'La password è più corta del minimo richiesto da Firebase.';
        if (status.meetsMaxPasswordLength === false) return 'La password supera la lunghezza massima consentita da Firebase.';
        if (status.containsLowercaseLetter === false) return 'La password deve contenere almeno 1 lettera minuscola.';
        if (status.containsUppercaseLetter === false) return 'La password deve contenere almeno 1 lettera maiuscola.';
        if (status.containsNumericCharacter === false) return 'La password deve contenere almeno 1 numero.';
        if (status.containsNonAlphanumericCharacter === false) return 'La password deve contenere almeno 1 carattere speciale.';
        return PASSWORD_POLICY_SUMMARY;
    } catch {
        // Firebase remains the final authority. If policy introspection is
        // temporarily unavailable, let the actual Auth operation decide.
        return null;
    }
}
