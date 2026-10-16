import { afterEach, describe, expect, it, vi } from 'vitest';

afterEach(() => {
  vi.unstubAllEnvs();
  vi.resetModules();
});

describe('trusted backend API origin', () => {
  it('preserves the established backend fallback when the optional env is absent', async () => {
    vi.stubEnv('VITE_ACCOUNT_DELETION_API_ORIGIN', '');
    const { BACKEND_API_ORIGIN } = await import('./backendApi');
    expect(BACKEND_API_ORIGIN).toBe('https://logbook-gnf.vercel.app');
  });

  it('prefers the configured origin and strips one trailing slash', async () => {
    vi.stubEnv('VITE_ACCOUNT_DELETION_API_ORIGIN', 'https://backend.example.test/');
    const { BACKEND_API_ORIGIN } = await import('./backendApi');
    expect(BACKEND_API_ORIGIN).toBe('https://backend.example.test');
  });

  it('preserves an already normalized configured origin', async () => {
    vi.stubEnv('VITE_ACCOUNT_DELETION_API_ORIGIN', 'https://backend.example.test');
    const { BACKEND_API_ORIGIN } = await import('./backendApi');
    expect(BACKEND_API_ORIGIN).toBe('https://backend.example.test');
  });
});
