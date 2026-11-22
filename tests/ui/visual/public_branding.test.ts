import { readFileSync } from 'node:fs';
import { createElement } from 'react';
import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import HeaderDashboard from '../../../src/components/Home/widgets/HeaderDashboard';

function bootstrapDocument(): Document {
  return new DOMParser().parseFromString(readFileSync('index.html', 'utf8'), 'text/html');
}

describe('public TheLogBook branding', () => {
  it('exposes the public brand through actual HTML metadata', () => {
    const document = bootstrapDocument();

    expect(document.title).toBe('TheLogBook');
    expect(document.documentElement.lang).toBe('it');
    expect(document.querySelector('meta[name="apple-mobile-web-app-title"]')?.getAttribute('content'))
      .toBe('TheLogBook');
    expect(document.querySelector('meta[property="og:title"]')?.getAttribute('content'))
      .toBe('TheLogBook');
    expect(document.querySelector('meta[name="twitter:title"]')?.getAttribute('content'))
      .toBe('TheLogBook');
    expect(document.querySelector('meta[name="description"]')?.getAttribute('content'))
      .toContain('TheLogBook');
    expect(document.querySelector('link[rel="icon"][type="image/svg+xml"]')?.getAttribute('href'))
      .toMatch(/^%BASE_URL%icon\.svg\?v=[\w-]+$/);
  });

  it('keeps the bootstrap loader accessible and preloads the artwork it actually displays', () => {
    const document = bootstrapDocument();
    const loader = document.querySelector('#initial-loader');

    expect(loader).not.toBeNull();
    expect(loader?.classList.contains('brand-loading-screen')).toBe(true);
    expect(loader?.getAttribute('role')).toBe('status');
    expect(loader?.getAttribute('aria-busy')).toBe('true');
    expect(loader?.getAttribute('aria-live')).toBe('polite');

    const artwork = loader?.querySelector('img.brand-loading-screen__mascot');
    const src = artwork?.getAttribute('src');
    expect(src).toMatch(/^%BASE_URL%loading-wait\.svg\?v=[\w-]+$/);
    expect(artwork?.getAttribute('alt')).toBe('');
    expect(document.querySelector('link[rel="preload"][as="image"]')?.getAttribute('href'))
      .toBe(src);

    const heading = loader?.querySelector('.brand-loading-screen__wordmark h1');
    expect(heading?.textContent).toBe('CARICAMENT');
    expect(heading?.querySelector('.brand-loading-screen__spinner')?.getAttribute('aria-hidden'))
      .toBe('true');
  });

  it('provides a valid, titled vector mascot', () => {
    const svg = new DOMParser().parseFromString(
      readFileSync('public/loading-wait.svg', 'utf8'),
      'image/svg+xml',
    );

    expect(svg.querySelector('parsererror')).toBeNull();
    expect(svg.documentElement.localName).toBe('svg');
    expect(svg.documentElement.getAttribute('viewBox')).toBe('0 0 1254 1254');
    expect(svg.querySelector('title')?.textContent).toBe('Cuoco in attesa');
  });

  it('renders the brand heading in the real home header component', () => {
    render(createElement(HeaderDashboard, { streak: 0, totalWorkouts: 0 }));

    expect(screen.getByRole('heading', { level: 1 }).textContent).toBe('TheLogBook');
  });
});
