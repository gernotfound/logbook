import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
    validatePassword: vi.fn(),
}));

vi.mock('../firebase', () => ({
    auth: {},
    validatePassword: mocks.validatePassword,
}));

import { PASSWORD_POLICY_SUMMARY, validatePasswordAgainstPolicy } from './passwordPolicy';

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
    beforeEach(() => vi.clearAllMocks());

    it('accepts a password only when Firebase policy validation accepts it', async () => {
        mocks.validatePassword.mockResolvedValue({
            isValid: true,
            passwordPolicy: policy,
        });

        await expect(validatePasswordAgainstPolicy('Anything')).resolves.toBeNull();
        expect(mocks.validatePassword).toHaveBeenCalledTimes(1);
    });

    it('reports the actual minimum returned by Firebase instead of a copied constant', async () => {
        mocks.validatePassword.mockResolvedValue({
            isValid: false,
            meetsMinPasswordLength: false,
            passwordPolicy: policy,
        });

        await expect(validatePasswordAgainstPolicy('Short1!')).resolves.toContain('almeno 12 caratteri');
    });

    it('maps Firebase requirement failures to a useful message', async () => {
        mocks.validatePassword.mockResolvedValue({
            isValid: false,
            containsNonAlphanumericCharacter: false,
            passwordPolicy: policy,
        });

        await expect(validatePasswordAgainstPolicy('Password123')).resolves.toContain('carattere speciale');
        expect(PASSWORD_POLICY_SUMMARY).not.toContain('8 caratteri');
    });
});
