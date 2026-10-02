export const PASSWORD_POLICY_SUMMARY =
    'La password deve contenere almeno 8 caratteri, con almeno una lettera maiuscola, una minuscola, un numero e un carattere speciale.';

export function checkPasswordStrength(password: string): string | null {
    if (password.length < 8) return 'La password deve contenere almeno 8 caratteri.';
    if (password.length > 4096) return 'La password è troppo lunga.';
    if (!/\d/.test(password)) return 'La password deve contenere almeno 1 numero.';
    if (!/[a-z]/.test(password)) return 'La password deve contenere almeno 1 lettera minuscola.';
    if (!/[A-Z]/.test(password)) return 'La password deve contenere almeno 1 lettera maiuscola.';
    if (!/[^A-Za-z0-9]/.test(password)) return 'La password deve contenere almeno 1 carattere speciale.';
    return null;
}
