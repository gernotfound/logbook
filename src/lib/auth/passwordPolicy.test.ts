import { beforeEach, describe, expect, it, vi } from 'vitest';
import { validatePassword } from '../firebase';
import { PASSWORD_POLICY_SUMMARY, validatePasswordAgainstPolicy } from './passwordPolicy';

const mockedValidatePassword = vi.mocked(validatePassword);

const policy = {
    customStrengthOptions: {
        minPasswordLength: 12,
        maxPasswordLength: 128,
        containsLowercaseLetter: true,
        containsUppercaseLetter: true,
        containsNumericCharacter: true,
        containsNonAlphanumericCharacter: true,
    },
};

describe('password policy', () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    it('accepts a password only when Firebase policy validation accepts it', async () => {
        mockedValidatePassword.mockResolvedValueOnce({
            isValid: true,
            passwordPolicy: policy,
        } as any);

        await expect(validatePasswordAgainstPolicy('Anything')).resolves.toBeNull();
        expect(mockedValidatePassword).toHaveBeenCalledTimes(1);
    });

    it('reports the actual minimum returned by Firebase instead of a copied constant', async () => {
        mockedValidatePassword.mockResolvedValueOnce({
            isValid: false,
            meetsMinPasswordLength: false,
            passwordPolicy: policy,
        } as any);

        await expect(validatePasswordAgainstPolicy('Short1!')).resolves.toContain('almeno 12 caratteri');
    });

    it('maps Firebase requirement failures to a useful message', async () => {
        mockedValidatePassword.mockResolvedValueOnce({
            isValid: false,
            containsNonAlphanumericCharacter: false,
            passwordPolicy: policy,
        } as any);

        await expect(validatePasswordAgainstPolicy('Password123')).resolves.toContain('carattere speciale');
        expect(PASSWORD_POLICY_SUMMARY).not.toContain('8 caratteri');
    });
});
