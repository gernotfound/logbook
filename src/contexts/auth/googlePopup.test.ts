import { describe, expect, it } from 'vitest';
import { classifyGooglePopupFailure } from './googlePopup';

describe('classifyGooglePopupFailure', () => {
    it('redirects only when popup usage is unavailable', () => {
        expect(classifyGooglePopupFailure({ code: 'auth/popup-blocked' })).toBe('redirect');
        expect(classifyGooglePopupFailure({ code: 'auth/operation-not-supported-in-this-environment' })).toBe('redirect');
    });

    it('does not redirect after deliberate cancellation or a network failure', () => {
        expect(classifyGooglePopupFailure({ code: 'auth/popup-closed-by-user' })).toBe('cancelled');
        expect(classifyGooglePopupFailure({ code: 'auth/cancelled-popup-request' })).toBe('cancelled');
        expect(classifyGooglePopupFailure({ code: 'auth/network-request-failed' })).toBe('network');
    });

    it('keeps unrelated failures on the normal error path', () => {
        expect(classifyGooglePopupFailure({ code: 'auth/internal-error' })).toBe('error');
        expect(classifyGooglePopupFailure(new Error('popup wording alone is not a signal'))).toBe('error');
    });
});
