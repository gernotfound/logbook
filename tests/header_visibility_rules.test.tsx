import React from 'react';
import { describe, expect, test, vi } from 'vitest';
import { render, screen } from '@testing-library/react';

vi.mock('../src/hooks/useAuth', () => ({
  useAuth: () => ({
    currentUser: null,
    loading: true,
    linkGoogleAccount: vi.fn(),
    isGuest: false,
  }),
}));

import App from '../src/App';

describe('Header visibility rules', () => {
  test('does not render navigation while app is preloading', () => {
    const { container } = render(<App />);

    expect(screen.getByText('Caricamento...')).toBeTruthy();
    expect(container.querySelector('#auth-loading')).toBeTruthy();
    expect(
      screen.queryByRole('navigation', { name: 'Navigazione principale' })
    ).toBeNull();
  });
});
