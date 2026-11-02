import { afterEach, describe, expect, it, vi } from 'vitest';

afterEach(() => {
  vi.unstubAllEnvs();
  vi.resetModules();
});

describe('trusted backend API origin', () => {
  it('fails closed without routing a missing configured origin to a backend', async () => {
    vi.stubEnv('VITE_ACCOUNT_DELETION_API_ORIGIN', '');
    const { BACKEND_API_ORIGIN, trustedBackendUrl } = await import('./backendApi');
    expect(BACKEND_API_ORIGIN).toBe('');
    expect(() => trustedBackendUrl('/api/health-consent')).toThrow('Backend trusted non configurato.');
  });

  it('rejects whitespace-only configuration rather than using a default host', async () => {
    vi.stubEnv('VITE_ACCOUNT_DELETION_API_ORIGIN', '   ');
    const { BACKEND_API_ORIGIN, trustedBackendUrl } = await import('./backendApi');
    expect(BACKEND_API_ORIGIN).toBe('');
    expect(() => trustedBackendUrl('/api/cloud-key')).toThrow('Backend trusted non configurato.');
  });

  it('prefers the configured origin and strips one trailing slash', async () => {
    vi.stubEnv('VITE_ACCOUNT_DELETION_API_ORIGIN', 'https://backend.example.test/');
    const { BACKEND_API_ORIGIN, trustedBackendUrl } = await import('./backendApi');
    expect(BACKEND_API_ORIGIN).toBe('https://backend.example.test');
    expect(trustedBackendUrl('/api/health-consent-export?collection=checkpoint'))
      .toBe('https://backend.example.test/api/health-consent-export?collection=checkpoint');
  });

  it('preserves an already normalized configured origin', async () => {
    vi.stubEnv('VITE_ACCOUNT_DELETION_API_ORIGIN', 'https://backend.example.test');
    const { BACKEND_API_ORIGIN } = await import('./backendApi');
    expect(BACKEND_API_ORIGIN).toBe('https://backend.example.test');
  });
});
