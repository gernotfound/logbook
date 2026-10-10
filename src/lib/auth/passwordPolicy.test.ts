import { beforeEach, describe, expect, it, vi } from 'vitest';
import { validatePassword } from '../firebase';
import { getPasswordBaselineError, getPasswordRequirements, PASSWORD_POLICY_SUMMARY, validatePasswordAgainstPolicy } from './passwordPolicy';

const mockedValidatePassword = vi.mocked(validatePassword);
const policy = {
    customStrengthOptions: {
        minPasswordLength: 20,
        maxPasswordLength: 128,
        containsLowercaseLetter: true,
        containsUppercaseLetter: true,
        containsNumericCharacter: true,
        containsNonAlphanumericCharacter: true,
    },
};

describe('password policy', () => {
    beforeEach(() => { vi.clearAllMocks(); });

    it('rejects a weak password before contacting Firebase', async () => {
        const requirements = getPasswordRequirements('caccapuou');
        expect(requirements.filter(requirement => !requirement.met).map(item => item.label))
            .toEqual(expect.arrayContaining(['Almeno 12 caratteri', 'Una lettera maiuscola', 'Un numero', 'Un carattere speciale']));
        expect(getPasswordBaselineError('caccapuou')).toContain('12 caratteri');
        await expect(validatePasswordAgainstPolicy('caccapuou')).resolves.toContain('12 caratteri');
        expect(mockedValidatePassword).not.toHaveBeenCalled();
    });

    it('accepts a strong password only after Firebase accepts its policy', async () => {
        mockedValidatePassword.mockResolvedValueOnce({ isValid: true, passwordPolicy: policy } as any);
        await expect(validatePasswordAgainstPolicy('SecurePassword123!')).resolves.toBeNull();
        expect(mockedValidatePassword).toHaveBeenCalledTimes(1);
    });

    it('reports the stricter minimum returned by Firebase', async () => {
        mockedValidatePassword.mockResolvedValueOnce({
            isValid: false, meetsMinPasswordLength: false, passwordPolicy: policy,
        } as any);
        await expect(validatePasswordAgainstPolicy('SecurePassword123!')).resolves.toContain('almeno 20 caratteri');
    });

    it('maps Firebase-only requirement failures even when local criteria are met', async () => {
        mockedValidatePassword.mockResolvedValueOnce({
            isValid: false, meetsMaxPasswordLength: false, passwordPolicy: policy,
        } as any);
        await expect(validatePasswordAgainstPolicy('SecurePassword123!')).resolves.toContain('128 caratteri');
        expect(PASSWORD_POLICY_SUMMARY).not.toContain('8 caratteri');
    });
});
