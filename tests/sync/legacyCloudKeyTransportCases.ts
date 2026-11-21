import { describe, expect, it, vi } from 'vitest';
import type { LegacyCloudKeyTestContext } from './m7_cloud_key_api.test';

export function registerLegacyCloudKeyTransportCases({
  harness, request, OPTIONS, POST,
}: LegacyCloudKeyTestContext): void {
  describe('HTTP origin, request-body budget and query authentication', () => {
  it('accepts an empty POST body stream, but never accepts payload bytes', async () => {
    // Vercel's Request adapter can expose a non-null body stream even when
    // the browser sends a bodyless POST.
    const empty = new Request('https://backend.test/api/cloud-key', {
      method: 'POST', headers: { origin: 'https://thelogbook.web.app' }, body: '',
    });
    expect(empty.body).not.toBeNull();
    expect((await POST(empty)).status).toBe(200);

    const zeroChunk = new Request('https://backend.test/api/cloud-key', {
      method: 'POST', headers: { origin: 'https://thelogbook.web.app' },
      body: new ReadableStream<Uint8Array>({
        start(controller) {
          controller.enqueue(new Uint8Array(0));
          controller.close();
        },
      }),
      duplex: 'half',
    } as RequestInit & { duplex: 'half' });
    expect((await POST(zeroChunk)).status).toBe(200);
    expect(harness.wrap).toHaveBeenCalledTimes(1);

    const nonEmpty = new Request('https://backend.test/api/cloud-key', {
      method: 'POST', headers: { origin: 'https://thelogbook.web.app' },
      body: new ReadableStream<Uint8Array>({
        start(controller) {
          controller.enqueue(new TextEncoder().encode('{"uid":"attacker"}'));
          controller.close();
        },
      }),
      duplex: 'half',
    } as RequestInit & { duplex: 'half' });
    const verifyCalls = harness.verify.mock.calls.length;
    expect((await POST(nonEmpty)).status).toBe(400);
    expect(harness.verify).toHaveBeenCalledTimes(verifyCalls);

    const declaredNonEmpty = new Request('https://backend.test/api/cloud-key', {
      method: 'POST', headers: { origin: 'https://thelogbook.web.app', 'content-length': '1' },
    });
    expect((await POST(declaredNonEmpty)).status).toBe(400);
    expect(harness.verify).toHaveBeenCalledTimes(verifyCalls);
  });

  it.each(['stalled', 'empty-chunk-then-stalled'] as const)(
    'bounds %s request-body inspection without running Auth or key provisioning',
    async scenario => {
      vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
      try {
        const body = new ReadableStream<Uint8Array>({
          start(controller) {
            if (scenario === 'empty-chunk-then-stalled') controller.enqueue(new Uint8Array(0));
          },
        });
        const stalled = new Request('https://backend.test/api/cloud-key', {
          method: 'POST',
          headers: { origin: 'https://thelogbook.web.app' },
          body,
          duplex: 'half',
        } as RequestInit & { duplex: 'half' });

        const responsePromise = POST(stalled);
        await vi.advanceTimersByTimeAsync(2_100);
        const response = await responsePromise;
        expect(response.status).toBe(408);
        expect(await response.json()).toEqual({ error: 'Lettura della richiesta scaduta. Riprova.' });
        expect(response.headers.get('cache-control')).toContain('no-store');
        expect(harness.verify).not.toHaveBeenCalled();
        expect(harness.wrap).not.toHaveBeenCalled();
        expect(harness.documents.has('user_data_keys/owner-a')).toBe(false);
      } finally {
        vi.useRealTimers();
      }
    },
  );

  it('treats an exhausted zero-byte inspection budget as retryable, not client payload', async () => {
    const tooManyEmptyChunks = new Request('https://backend.test/api/cloud-key', {
      method: 'POST',
      headers: { origin: 'https://thelogbook.web.app' },
      body: new ReadableStream<Uint8Array>({
        start(controller) {
          for (let i = 0; i < 17; i++) controller.enqueue(new Uint8Array(0));
          controller.close();
        },
      }),
      duplex: 'half',
    } as RequestInit & { duplex: 'half' });
    const response = await POST(tooManyEmptyChunks);
    expect(response.status).toBe(408);
    expect(await response.json()).toEqual({ error: 'Lettura della richiesta scaduta. Riprova.' });
    expect(response.headers.get('cache-control')).toContain('no-store');
    expect(harness.verify).not.toHaveBeenCalled();
    expect(harness.wrap).not.toHaveBeenCalled();
    expect(harness.documents.has('user_data_keys/owner-a')).toBe(false);
  });

  it('returns 503 for invalid public-origin configuration without leaking an account key', async () => {
    vi.stubEnv('PUBLIC_APP_ORIGIN', 'http://invalid.example/path');
    try {
      const preflight = await OPTIONS(new Request('https://backend.test/api/cloud-key', {
        method: 'OPTIONS', headers: { origin: 'https://thelogbook.web.app' },
      }));
      const actual = await POST(request());
      for (const response of [preflight, actual]) {
        expect(response.status).toBe(503);
        expect(response.headers.get('access-control-allow-origin')).toBeNull();
        expect(response.headers.get('cache-control')).toContain('no-store');
        expect(await response.text()).not.toMatch(/[A-Za-z0-9+/]{43}=/);
      }
      expect(harness.verify).not.toHaveBeenCalled();
      expect(harness.wrap).not.toHaveBeenCalled();
    } finally {
      vi.unstubAllEnvs();
    }
  });

  it('keeps interrupted body reads fail-closed without authenticating or provisioning a key', async () => {
    const interrupted = new Request('https://backend.test/api/cloud-key', {
      method: 'POST', headers: { origin: 'https://thelogbook.web.app' },
      body: new ReadableStream<Uint8Array>({
        start(controller) { controller.error(new Error('body stream broken')); },
      }),
      duplex: 'half',
    } as RequestInit & { duplex: 'half' });
    const response = await POST(interrupted);
    expect(response.status).toBe(503);
    expect(await response.text()).not.toContain('body stream broken');
    expect(harness.verify).not.toHaveBeenCalled();
    expect(harness.wrap).not.toHaveBeenCalled();
  });

  it('accepts a delayed empty body that finishes before the inspection deadline', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    try {
      const body = new ReadableStream<Uint8Array>({
        start(controller) { setTimeout(() => controller.close(), 500); },
      });
      const delayed = new Request('https://backend.test/api/cloud-key', {
        method: 'POST',
        headers: { origin: 'https://thelogbook.web.app' },
        body,
        duplex: 'half',
      } as RequestInit & { duplex: 'half' });

      const responsePromise = POST(delayed);
      await vi.advanceTimersByTimeAsync(500);
      expect((await responsePromise).status).toBe(200);
      expect(harness.wrap).toHaveBeenCalledTimes(1);
    } finally {
      vi.useRealTimers();
    }
  });

  it('accepts a bodyless rights export without provisioning a new key', async () => {
    expect((await POST(request())).status).toBe(200);
    harness.documents.set('health_consent_withdrawals/owner-a', { uid: 'owner-a', status: 'withdrawn', revision: 2 });
    harness.verify.mockResolvedValue({ uid: 'owner-a', emailVerified: false });
    const rights = new Request('https://backend.test/api/cloud-key?purpose=rights-export', {
      method: 'POST', headers: { origin: 'https://thelogbook.web.app' }, body: '',
    });
    expect(rights.body).not.toBeNull();
    expect((await POST(rights)).status).toBe(200);
    expect(harness.wrap).toHaveBeenCalledTimes(1);
  });

  it('rejects foreign Origin and unverified email before any key material is accessed', async () => {
    expect((await POST(request('https://attacker.example'))).status).toBe(403);
    expect(harness.verify).not.toHaveBeenCalled();
    harness.verify.mockResolvedValue({ uid: 'owner-a', emailVerified: false });
    expect((await POST(request())).status).toBe(403);
    expect(harness.wrap).not.toHaveBeenCalled();
    expect((await OPTIONS(new Request('https://backend.test/api/cloud-key', {
      method: 'OPTIONS', headers: { origin: 'https://thelogbook.web.app' },
    }))).status).toBe(204);
  });


  it.each([
    ['client-selected uid', '?uid=another-account'],
    ['client-supplied key', '?key=untrusted'],
    ['unknown purpose', '?purpose=sync'],
    ['duplicate purpose', '?purpose=rights-export&purpose=rights-export'],
    ['empty purpose', '?purpose='],
    ['rights export with uid', '?purpose=rights-export&uid=another-account'],
  ])('rejects %s query before authentication or key access', async (_case, query) => {
    const response = await POST(new Request(`https://backend.test/api/cloud-key${query}`, {
      method: 'POST',
      headers: { origin: 'https://thelogbook.web.app' },
    }));
    expect(response.status).toBe(400);
    expect(harness.verify).not.toHaveBeenCalled();
    expect(harness.wrap).not.toHaveBeenCalled();
    expect(harness.unwrap).not.toHaveBeenCalled();
    expect(harness.documents.has('user_data_keys/owner-a')).toBe(false);
  });

  it('ignores client-supplied uid/key and always uses verified caller identity', async () => {
    const result = await POST(request('https://thelogbook.web.app', true));
    expect(result.status).toBe(400);

    // A request body without Content-Length must also be rejected before Auth.
    const withoutLength = new Request('https://backend.test/api/cloud-key', {
      method: 'POST',
      headers: { origin: 'https://thelogbook.web.app' },
      body: '{"uid":"another-account"}',
    });
    expect(withoutLength.headers.has('content-length')).toBe(false);
    expect((await POST(withoutLength)).status).toBe(400);

    expect(harness.verify).not.toHaveBeenCalled();
    expect(harness.documents.has('user_data_keys/owner-a')).toBe(false);
  });
  });
}
