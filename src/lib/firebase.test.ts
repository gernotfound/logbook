import { describe, expect, it, vi } from 'vitest';
import { browserLocalPersistence, browserPopupRedirectResolver, initializeAuth } from 'firebase/auth';

// Importing the module performs Firebase Auth initialization.
import './firebase';

describe('Firebase Auth bootstrap', () => {
    it('configures the popup/redirect resolver required by Google auth flows', () => {
        expect(vi.mocked(initializeAuth)).toHaveBeenCalledWith(
            expect.anything(),
            expect.objectContaining({
                persistence: browserLocalPersistence,
                popupRedirectResolver: browserPopupRedirectResolver,
            })
        );
    });
});