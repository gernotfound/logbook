import { beforeEach, describe, expect, it, vi } from 'vitest';
import { validatePassword } from '../firebase';
import { getPasswordRequirements, loadPasswordRuleConfig, PASSWORD_POLICY_SUMMARY, validatePasswordAgainstPolicy } from './passwordPolicy';

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
    beforeEach(() => { vi.clearAllMocks(); mockedValidatePassword.mockReset(); });

    it('shows immediate advisory hints without treating them as the server policy', () => {
        const requirements = getPasswordRequirements('caccapuou');
        expect(requirements.find(item => item.label === 'Almeno 8 caratteri')?.met).toBe(true);
        expect(requirements.filter(item => !item.met).map(item => item.label))
            .toEqual(expect.arrayContaining(['Una lettera maiuscola', 'Un numero', 'Un carattere speciale']));
        expect(mockedValidatePassword).not.toHaveBeenCalled();
    });

    it('preserves the documented minimum and adds stricter criteria returned by Firebase', async () => {
        mockedValidatePassword.mockResolvedValueOnce({ isValid: false, passwordPolicy: policy } as any);
        const config = await loadPasswordRuleConfig();
        expect(getPasswordRequirements('SecurePassword123!', config).find(item => item.label === 'Almeno 20 caratteri')?.met).toBe(false);
        expect(mockedValidatePassword).toHaveBeenCalledWith(expect.anything(), '');
    });

    it('refuses obviously weak passwords even if a backend fixture reports success', async () => {
        mockedValidatePassword.mockResolvedValueOnce({ isValid: true, passwordPolicy: policy } as any);
        await expect(validatePasswordAgainstPolicy('caccapuou')).resolves.toContain('maiuscola');
        expect(mockedValidatePassword).not.toHaveBeenCalled();
    });

    it('accepts a password only when Firebase accepts it', async () => {
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

    it('maps Firebase-only requirement failures', async () => {
        mockedValidatePassword.mockResolvedValueOnce({
            isValid: false, meetsMaxPasswordLength: false, passwordPolicy: policy,
        } as any);
        await expect(validatePasswordAgainstPolicy('SecurePassword123!')).resolves.toContain('128 caratteri');
        expect(PASSWORD_POLICY_SUMMARY).not.toContain('8 caratteri');
    });
});
