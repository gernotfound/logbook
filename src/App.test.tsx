import { render, screen } from '@testing-library/react';
import { expect, test, vi } from 'vitest';

vi.mock('./components/UI/KindeAccountEntry', () => ({
    // Isolate hosted identity UI, but assert the real App's entry contract.
    KindeAccountEntry: ({ identityOnly, onLocalGuest }: { identityOnly?: boolean; onLocalGuest?: unknown }) =>
        <div data-testid="kinde-identity-entry"
            data-identity-only={String(identityOnly)}
            data-guest-action={String(typeof onLocalGuest === 'function')} />,
}));

import App from './App';

test('shows the unauthenticated entry screen with the application heading', () => {
    const { container } = render(<App />);
    expect(container.querySelector('#auth-overlay')).not.toBeNull();
    expect(screen.getByRole('heading', { name: 'TheLogBook' })).toBeDefined();
    const entry = screen.getByTestId('kinde-identity-entry');
    expect(entry.getAttribute('data-identity-only')).toBe('true');
    expect(entry.getAttribute('data-guest-action')).toBe('true');
    // Signed-out App cannot mount business views before any owner is selected.
    expect(container.querySelector('#view-training')).toBeNull();
    expect(container.querySelector('#view-nutrition')).toBeNull();
    expect(container.querySelector('#view-data')).toBeNull();
});
