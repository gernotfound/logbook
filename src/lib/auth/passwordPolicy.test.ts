import { describe, expect, it } from 'vitest';
import { checkPasswordStrength, PASSWORD_POLICY_SUMMARY } from './passwordPolicy';

describe('password policy', () => {
    it('matches the Firebase Auth policy enforced in Production', () => {
        expect(checkPasswordStrength('Password1!')).toBeNull();
        expect(checkPasswordStrength('Abc1~def')).toBeNull();
        expect(PASSWORD_POLICY_SUMMARY).toContain('almeno 8 caratteri');
    });

    it.each([
        ['Short1!', 'almeno 8 caratteri'],
        ['password!', 'almeno 1 numero'],
        ['PASSWORD1!', 'almeno 1 lettera minuscola'],
        ['password1!', 'almeno 1 lettera maiuscola'],
        ['Password1', 'almeno 1 carattere speciale'],
        ['Abc1 def', 'almeno 1 carattere speciale'],
    ])('rejects %s', (password, expected) => {
        expect(checkPasswordStrength(password)).toContain(expected);
    });

    it('rejects values above the server maximum', () => {
        expect(checkPasswordStrength(`A1!${'a'.repeat(4094)}`)).toBe('La password è troppo lunga.');
    });
});
