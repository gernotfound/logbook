import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

beforeEach(() => vi.resetModules());

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
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

  it('does not send health-erasure HTTP requests when backend configuration is missing', async () => {
    vi.stubEnv('VITE_ACCOUNT_DELETION_API_ORIGIN', '');
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    const { sendHealthDataErasure } = await import('./healthDataErasureTransport');
    await expect(sendHealthDataErasure('POST', {
      authorization: 'Bearer dummy-token',
      'x-firebase-appcheck': 'dummy-app-check',
    })).rejects.toThrow('Backend trusted non configurato.');
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('sends health-erasure requests to the explicitly configured origin', async () => {
    vi.stubEnv('VITE_ACCOUNT_DELETION_API_ORIGIN', 'https://backend.example.test/');
    const body = { status: 'pending' };
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => body,
    });
    vi.stubGlobal('fetch', fetchMock);
    const { sendHealthDataErasure } = await import('./healthDataErasureTransport');
    await expect(sendHealthDataErasure('POST', {
      authorization: 'Bearer dummy-token',
      'x-firebase-appcheck': 'dummy-app-check',
    })).resolves.toEqual(body);
    expect(fetchMock).toHaveBeenCalledWith(
      'https://backend.example.test/api/health-data-erasure',
      expect.objectContaining({ method: 'POST', cache: 'no-store' }),
    );
  });

  it('prefers the configured origin and strips one trailing slash', async () => {
    vi.stubEnv('VITE_ACCOUNT_DELETION_API_ORIGIN', 'https://backend.example.test/');
    const { BACKEND_API_ORIGIN, trustedBackendUrl } = await import('./backendApi');
    expect(BACKEND_API_ORIGIN).toBe('https://backend.example.test');
    expect(trustedBackendUrl('/api/health-consent-export?collection=checkpoint'))
      .toBe('https://backend.example.test/api/health-consent-export?collection=checkpoint');
  });

  it.each([
    'http://untrusted.example',
    'https://backend.example.test/path',
    'https://backend.example.test/?query=1',
    'https://backend.example.test/#fragment',
    'https://user:secret@backend.example.test',
    '//backend.example.test',
    'javascript:alert(1)',
  ])('rejects unsafe backend origin %s before an authenticated request', async configured => {
    vi.stubEnv('VITE_ACCOUNT_DELETION_API_ORIGIN', configured);
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    const { BACKEND_API_ORIGIN, trustedBackendUrl } = await import('./backendApi');
    expect(BACKEND_API_ORIGIN).toBe('');
    expect(() => trustedBackendUrl('/api/account-sessions')).toThrow('Backend trusted non configurato.');

    const { sendHealthDataErasure } = await import('./healthDataErasureTransport');
    await expect(sendHealthDataErasure('POST', {
      authorization: 'Bearer dummy-token',
      'x-firebase-appcheck': 'dummy-app-check',
    })).rejects.toThrow('Backend trusted non configurato.');
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it.each([
    ['http://127.0.0.1:9/', 'http://127.0.0.1:9'],
    ['http://localhost:3000', 'http://localhost:3000'],
    ['http://[::1]:9', 'http://[::1]:9'],
  ])('permits local test backend %s', async (configured, expected) => {
    vi.stubEnv('VITE_ACCOUNT_DELETION_API_ORIGIN', configured);
    const { BACKEND_API_ORIGIN, trustedBackendUrl } = await import('./backendApi');
    expect(BACKEND_API_ORIGIN).toBe(expected);
    expect(trustedBackendUrl('/api/health-consent')).toBe(expected + '/api/health-consent');
  });

  it('preserves an already normalized configured origin', async () => {
    vi.stubEnv('VITE_ACCOUNT_DELETION_API_ORIGIN', 'https://backend.example.test');
    const { BACKEND_API_ORIGIN } = await import('./backendApi');
    expect(BACKEND_API_ORIGIN).toBe('https://backend.example.test');
  });
});
