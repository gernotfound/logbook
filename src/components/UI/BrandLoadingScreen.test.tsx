import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import BrandLoadingScreen from './BrandLoadingScreen';

afterEach(() => {
  cleanup();
});

describe('BrandLoadingScreen', () => {
  it('renders the canonical fullscreen loading splash', () => {
    const { container } = render(<BrandLoadingScreen label="Avvio test" />);
    const status = screen.getByRole('status', { name: 'Avvio test' });

    expect(status.className).toBe('brand-loading-screen');
    expect(status.getAttribute('aria-busy')).toBe('true');

    const mascot = container.querySelector<HTMLImageElement>('.brand-loading-screen__mascot');
    expect(mascot?.getAttribute('src')).toContain('/loading-wait.svg?v=20261007-waiting-mascot');
    expect(mascot?.getAttribute('fetchpriority')).toBe('high');

    const wordmark = container.querySelector('.brand-loading-screen__wordmark');
    expect(wordmark?.getAttribute('data-text')).toBe('Caricamento');
    expect(wordmark?.querySelector('h1')?.textContent).toBe('Caricamento');
  });

  it('uses the same loading contract for lazy content loading', () => {
    const { container } = render(
      <BrandLoadingScreen variant="content" label="Caricamento sezione" />,
    );
    const status = screen.getByRole('status', { name: 'Caricamento sezione' });

    expect(status.className).toContain('brand-loading-screen--content');
    expect(container.querySelector('.brand-loading-screen__mascot')).not.toBeNull();
    expect(container.querySelector('.brand-loading-screen__wordmark')).not.toBeNull();
  });
});
