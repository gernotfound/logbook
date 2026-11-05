import React from 'react';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { reload } from '../src/lib/firebase';
import { safeHardReload } from '../src/lib/sync/safeReload';

const fixture = vi.hoisted(() => ({
    user: {
        uid: 'linked-user', email: 'linked@example.test',
        providerData: [{ providerId: 'google.com' }],
        getIdToken: vi.fn(async () => 'synthetic-token'),
    },
    showAlert: vi.fn(async () => {}),
}));
vi.mock('../src/hooks/useAuth', () => ({
    useAuth: () => ({ currentUser: fixture.user, isGuest: false, emailVerificationRequired: false }),
}));
vi.mock('../src/hooks/useSettings', () => ({
    useSettings: () => ({ handleLogout: vi.fn(), handleLogoutEverywhere: vi.fn() }),
}));
vi.mock('../src/store/useDialogStore', () => ({
    useDialogStore: () => ({ showAlert: fixture.showAlert }),
}));
vi.mock('../src/lib/auth/recentAuth', async importOriginal => ({
    ...await importOriginal<typeof import('../src/lib/auth/recentAuth')>(),
    reauthenticateForSensitiveAction: vi.fn(async () => 'reauthenticated'),
}));
vi.mock('../src/lib/auth/passwordPolicy', () => ({
    validatePasswordAgainstPolicy: vi.fn(async () => null),
}));
vi.mock('../src/lib/sync/safeReload', () => ({ safeHardReload: vi.fn(async () => {}) }));
import { AccountCard } from '../src/components/UI/AccountCard';

beforeEach(() => {
    vi.clearAllMocks();
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(
        new Response(JSON.stringify({ localId: fixture.user.uid }), { status: 200 }),
    ));
});
afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
});

describe('confirmed credential link with a failed local refresh', () => {
    it('closes the link form and prevents resubmission even when both refresh and safe navigation fail', async () => {
        vi.mocked(reload).mockRejectedValueOnce(new Error('PRIVATE_REFRESH_FAILURE'));
        vi.mocked(safeHardReload).mockRejectedValueOnce(new Error('draft barrier blocked'));
        render(<AccountCard />);
        fireEvent.click(screen.getByRole('button', { name: 'Crea Password per accedere con Email' }));
        fireEvent.change(screen.getByPlaceholderText('Nuova Password'), { target: { value: 'SecurePassword123!' } });
        fireEvent.click(screen.getByRole('button', { name: 'Conferma' }));

        await waitFor(() => expect(safeHardReload).toHaveBeenCalledOnce());
        await waitFor(() => expect(screen.queryByPlaceholderText('Nuova Password')).toBeNull());
        expect(fetch).toHaveBeenCalledTimes(1);
        expect(reload).toHaveBeenCalledExactlyOnceWith(fixture.user);
        expect(screen.queryByRole('button', { name: 'Crea Password per accedere con Email' })).toBeNull();
        expect(screen.getByRole('button', { name: 'Cambia Password' })).toBeTruthy();
        expect(fixture.showAlert).toHaveBeenCalledWith(expect.stringContaining('il collegamento è già completato'));
        expect(JSON.stringify(fixture.showAlert.mock.calls)).not.toContain('PRIVATE_REFRESH_FAILURE');

        fireEvent.click(screen.getByRole('button', { name: 'Cambia Password' }));
        expect(screen.getByPlaceholderText('Password Attuale')).toBeTruthy();
        expect(fetch).toHaveBeenCalledTimes(1);
    });
});
