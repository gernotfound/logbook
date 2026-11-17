import { render, screen } from '@testing-library/react';
import { expect, test, vi } from 'vitest';

vi.mock('./components/UI/KindeAccountEntry', () => ({
    KindeAccountEntry: () => <div data-testid="kinde-identity-entry" />,
}));

import App from './App';

test('shows the unauthenticated entry screen with the application heading', () => {
    const { container } = render(<App />);
    expect(container.querySelector('#auth-overlay')).not.toBeNull();
    expect(screen.getByRole('heading', { name: 'TheLogBook' })).toBeDefined();
    expect(screen.getByTestId('kinde-identity-entry')).toBeDefined();
});
