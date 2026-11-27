import { render, screen, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

const state = vi.hoisted(() => ({
    user: null as { uid: string } | null,
    guest: true,
    logout: vi.fn(),
}));

vi.mock('../../../src/hooks/useAuth', () => ({
    useAuth: () => ({ currentUser: state.user, isGuest: state.guest }),
}));
vi.mock('../../../src/hooks/useSettings', () => ({
    useSettings: () => ({ handleLogout: state.logout }),
}));
vi.mock('../../../src/components/UI/AccountCardLegacy', () => ({
    LegacyAccountCard: () => <h2>Controlli account legacy</h2>,
}));

import { AccountCard } from '../../../src/components/UI/AccountCard';

describe('Account card session routing', () => {
    it('loads account-only controls after a verified non-guest transition and removes them on logout', async () => {
        state.guest = true;
        state.user = null;
        const view = render(<AccountCard />);
        expect(screen.getByRole('heading', { name: 'Modalità locale' })).toBeTruthy();
        expect(screen.queryByText('Controlli account legacy')).toBeNull();

        state.guest = false;
        state.user = { uid: 'account-a' };
        view.rerender(<AccountCard />);
        expect(await screen.findByText('Controlli account legacy')).toBeTruthy();
        expect(screen.queryByRole('heading', { name: 'Modalità locale' })).toBeNull();

        state.guest = true;
        state.user = { uid: 'account-a' };
        view.rerender(<AccountCard />);
        await waitFor(() => expect(screen.queryByText('Controlli account legacy')).toBeNull());
        expect(screen.queryByRole('heading', { name: 'Modalità locale' })).toBeNull();

        state.user = null;
        view.rerender(<AccountCard />);
        expect(screen.getByRole('heading', { name: 'Modalità locale' })).toBeTruthy();
        view.unmount();
    });
});
