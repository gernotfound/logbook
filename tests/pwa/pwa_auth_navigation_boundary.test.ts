import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { AUTH_HTTP_NAVIGATION_DENYLIST } from '../../src/lib/pwaHttpNavigationBoundary';

describe('PWA trusted HTTP navigation boundary', () => {
  it('does not swallow an OAuth callback or API request under a controlled service worker', () => {
    for (const path of [
      '/api/auth/kinde/callback?code=synthetic&state=synthetic',
      '/api/auth/kinde/start',
      '/api/auth/session',
      '/api/auth/logout',
      '/api/auth',
      '/v1/sync/read',
      '/v1/consent/initial',
      '/v1/auth/logout',
      '/v1',
    ]) {
      const url = new URL(path, 'https://candidate.invalid');
      expect(AUTH_HTTP_NAVIGATION_DENYLIST.test(url.pathname), path).toBe(true);
    }
  });

  it('preserves PWA app-shell shortcuts and unrelated or similarly named paths', () => {
    for (const path of [
      '/', '/?tab=training', '/index.html', '/about', '/privacy',
      '/api/other', '/api/authentication', '/v10/example',
      '/training', '/settings',
    ]) {
      const url = new URL(path, 'https://candidate.invalid');
      expect(AUTH_HTTP_NAVIGATION_DENYLIST.test(url.pathname), path).toBe(false);
    }
  });

  it('is wired into the production Workbox navigation route, not merely a dormant helper', () => {
    const swSource = readFileSync('src/sw.ts', 'utf8');
    expect(swSource).toContain("import { AUTH_HTTP_NAVIGATION_DENYLIST } from './lib/pwaHttpNavigationBoundary'");
    expect(swSource).toContain(
      "denylist: [/^\\/__\\//, /^\\/(?:about|privacy)(?:\\/|\\.html|$)/, AUTH_HTTP_NAVIGATION_DENYLIST]",
    );
    expect(swSource).toContain("createHandlerBoundToURL('/index.html')");
  });
});
