import { beforeEach, describe, expect, it, vi } from 'vitest';
import { validatePassword } from '../firebase';
import {
    getPasswordRequirements, loadPasswordRuleConfig, MIN_NEW_PASSWORD_LENGTH,
    PASSWORD_POLICY_SUMMARY, validatePasswordAgainstPolicy,
} from './passwordPolicy';

const mockedValidatePassword = vi.mocked(validatePassword);
const currentFirebaseRules = {
    minPasswordLength: 8,
    maxPasswordLength: 4096,
    containsLowercaseLetter: true,
    containsUppercaseLetter: true,
    containsNumericCharacter: true,
    containsNonAlphanumericCharacter: true,
};
const futureFirebaseRules = { minPasswordLength: 15, maxPasswordLength: 4096 };
const providerStatus = (isValid: boolean, rules: object, more: object = {}) => ({
    isValid,
    passwordPolicy: { customStrengthOptions: rules, enforcementState: 'ENFORCE', forceUpgradeOnSignin: false },
    ...more,
});

describe('password policy', () => {
    beforeEach(() => { vi.clearAllMocks(); mockedValidatePassword.mockReset(); });

    it('requires at least 15 Unicode characters but no composition categories locally', async () => {
        expect(MIN_NEW_PASSWORD_LENGTH).toBe(15);
        expect(getPasswordRequirements('tuttominuscoloenientealtro')).toEqual([
            { label: 'Almeno 15 caratteri', met: true },
        ]);
        expect(getPasswordRequirements('abcdefghijklmno')).toEqual([
            { label: 'Almeno 15 caratteri', met: true },
        ]);
        expect(getPasswordRequirements('abcdefghijklmn')[0].met).toBe(false);
        await expect(validatePasswordAgainstPolicy('abcdefghijklmn')).resolves.toContain('15 caratteri');
        expect(mockedValidatePassword).not.toHaveBeenCalled();
    });

    it('counts Unicode code points, does not trim spaces or normalize submitted passphrases', async () => {
        expect(getPasswordRequirements('🐱'.repeat(14))[0].met).toBe(false);
        expect(getPasswordRequirements('🐱'.repeat(15))[0].met).toBe(true);
        const passphrase = '  uno due tre quattro cinque 🐱  ';
        mockedValidatePassword.mockResolvedValueOnce(providerStatus(true, futureFirebaseRules) as any);
        await expect(validatePasswordAgainstPolicy(passphrase)).resolves.toBeNull();
        expect(mockedValidatePassword).toHaveBeenCalledExactlyOnceWith(expect.anything(), passphrase);
        expect(getPasswordRequirements('é'.repeat(15))[0].met).toBe(true);
    });

    it('fetches effective remote hints without inserting obsolete static character rules', async () => {
        mockedValidatePassword.mockResolvedValueOnce(providerStatus(false, futureFirebaseRules) as any);
        const rules = await loadPasswordRuleConfig();
        expect(rules).toEqual(futureFirebaseRules);
        expect(getPasswordRequirements('una lunga passphrase', rules)).toEqual([
            { label: 'Almeno 15 caratteri', met: true },
            { label: 'Massimo 4096 caratteri', met: true },
        ]);
        expect(mockedValidatePassword).toHaveBeenCalledExactlyOnceWith(expect.anything(), '');
    });

    it('shows old composition hints only when the effective Firebase policy requires them', async () => {
        mockedValidatePassword.mockResolvedValueOnce(providerStatus(false, currentFirebaseRules) as any);
        const rules = await loadPasswordRuleConfig();
        expect(getPasswordRequirements('tuttominuscoloenientealtro', rules).filter(x => !x.met).map(x => x.label))
            .toEqual(['Una lettera maiuscola', 'Un numero', 'Un carattere speciale']);
        expect(getPasswordRequirements('abcdefghijklmno', { minPasswordLength: 8 })[0])
            .toEqual({ label: 'Almeno 15 caratteri', met: true });
    });

    it('accepts 15+ character lowercase passphrases after the Firebase policy is changed', async () => {
        const password = 'una frase senza numeri';
        mockedValidatePassword.mockResolvedValueOnce(providerStatus(true, futureFirebaseRules) as any);
        await expect(validatePasswordAgainstPolicy(password)).resolves.toBeNull();
        expect(mockedValidatePassword).toHaveBeenCalledExactlyOnceWith(expect.anything(), password);
    });

    it('continues rejecting a password that Firebase currently rejects before cutover', async () => {
        mockedValidatePassword.mockResolvedValueOnce(providerStatus(false, currentFirebaseRules, {
            containsUppercaseLetter: false, containsNumericCharacter: false,
        }) as any);
        await expect(validatePasswordAgainstPolicy('una passphrase tutta minuscola')).resolves.toContain('Firebase richiede ancora');
        expect(mockedValidatePassword).toHaveBeenCalledTimes(1);
    });

    it.each([
        ['containsNumericCharacter', 'numero'],
        ['containsLowercaseLetter', 'minuscola'],
        ['containsUppercaseLetter', 'maiuscola'],
        ['containsNonAlphanumericCharacter', 'speciale'],
    ] as const)('describes effective remote requirement %s', async (field, message) => {
        mockedValidatePassword.mockResolvedValueOnce(providerStatus(false, currentFirebaseRules, { [field]: false }) as any);
        await expect(validatePasswordAgainstPolicy('passwordconalmenoquindici')).resolves.toContain(message);
    });

    it('reports stricter Firebase minimum and maximum limits when returned by the provider', async () => {
        mockedValidatePassword.mockResolvedValueOnce(providerStatus(false, { minPasswordLength: 25 }, { meetsMinPasswordLength: false }) as any);
        await expect(validatePasswordAgainstPolicy('abcdefghijklmnop')).resolves.toContain('25 caratteri');
        mockedValidatePassword.mockResolvedValueOnce(providerStatus(false, { maxPasswordLength: 16 }, { meetsMaxPasswordLength: false }) as any);
        await expect(validatePasswordAgainstPolicy('abcdefghijklmnopq')).resolves.toContain('16 caratteri');
        expect(getPasswordRequirements('abcdefghijklmno', { minPasswordLength: 25 })[0].met).toBe(false);
        expect(getPasswordRequirements('abcdefghijklmnopq', { maxPasswordLength: 16 })[1].met).toBe(false);
    });

    it('supports Firebase maximum 4096 without silently truncating the value', async () => {
        const password = 'a'.repeat(4096);
        expect(getPasswordRequirements(password, futureFirebaseRules).every(x => x.met)).toBe(true);
        expect(getPasswordRequirements(password + 'a', futureFirebaseRules)[1].met).toBe(false);
        mockedValidatePassword.mockResolvedValueOnce(providerStatus(true, futureFirebaseRules) as any);
        await expect(validatePasswordAgainstPolicy(password)).resolves.toBeNull();
        expect(mockedValidatePassword).toHaveBeenCalledExactlyOnceWith(expect.anything(), password);
    });

    it('fails closed on Firebase policy outages and incomplete provider responses', async () => {
        const offline = new Error('network error with private details');
        mockedValidatePassword.mockRejectedValueOnce(offline);
        await expect(validatePasswordAgainstPolicy('password sufficientemente lunga')).rejects.toMatchObject({
            code: 'auth/password-policy-unavailable',
        });
        mockedValidatePassword.mockRejectedValueOnce(offline);
        await expect(loadPasswordRuleConfig()).rejects.toBe(offline);
        for (const response of [null, undefined, {}]) {
            mockedValidatePassword.mockResolvedValueOnce(response as any);
            await expect(validatePasswordAgainstPolicy('password sufficientemente lunga'))
                .rejects.toMatchObject({ code: 'auth/password-policy-unavailable' });
        }
    });

    it('retains local hints if policy detail is absent, but never authorizes a Firebase rejection', async () => {
        mockedValidatePassword.mockResolvedValueOnce({ isValid: false } as any);
        expect(await loadPasswordRuleConfig()).toEqual({});
        expect(getPasswordRequirements('password sufficientemente lunga').map(x => x.label))
            .toEqual(['Almeno 15 caratteri']);
        mockedValidatePassword.mockResolvedValueOnce({ isValid: false } as any);
        await expect(validatePasswordAgainstPolicy('password sufficientemente lunga'))
            .resolves.toBe(PASSWORD_POLICY_SUMMARY);
    });

    it('does not interpret unrequired character indicators as Firebase requirements', async () => {
        mockedValidatePassword.mockResolvedValueOnce(providerStatus(false, futureFirebaseRules, {
            containsNumericCharacter: false,
        }) as any);
        await expect(validatePasswordAgainstPolicy('password sufficientemente lunga'))
            .resolves.toBe(PASSWORD_POLICY_SUMMARY);
    });
});
