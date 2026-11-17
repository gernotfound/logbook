import { render, screen } from '@testing-library/react';
import App from './App';
import { expect, test } from 'vitest';

test('shows the unauthenticated entry screen with the application heading', () => {
    const { container } = render(<App />);
    expect(container.querySelector('#auth-overlay')).not.toBeNull();
    expect(screen.getByRole('heading', { name: 'TheLogBook' })).toBeDefined();
});
