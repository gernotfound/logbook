import { scryptSync, timingSafeEqual } from 'node:crypto';
import { commitSyntheticBatch, prepareFixture, readReceipt, readSyntheticState } from './contract.mjs';

const headers = { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' };
const syntheticPassword = 'TheLogBook-DF00-synthetic-only-long-phrase';
const encoder = new TextEncoder();

function json(value, status = 200) { return new Response(JSON.stringify(value), { status, headers }); }

function authorized(request, env) {
  if (env.CF00_PROBE_ENABLED !== 'true' || typeof env.CF00_PROBE_SECRET !== 'string'
    || env.CF00_PROBE_SECRET.length < 32) return false;
  const supplied = request.headers.get('x-cf00-secret') ?? '';
  const expected = encoder.encode(env.CF00_PROBE_SECRET);
  const received = encoder.encode(supplied);
  return expected.length === received.length && timingSafeEqual(expected, received);
}

async function measurePbKdf2() {
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const key = await crypto.subtle.importKey('raw', encoder.encode(syntheticPassword), 'PBKDF2', false, ['deriveBits']);
  const begin = performance.now();
  const bytes = await crypto.subtle.deriveBits({ name: 'PBKDF2', hash: 'SHA-256', salt, iterations: 600000 }, key, 256);
  const elapsed = performance.now() - begin;
  return { algorithm: 'pbkdf2-sha256', workFactor: 600000, wallMs: elapsed, outputBits: bytes.byteLength * 8 };
}

async function measureScrypt() {
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const begin = performance.now();
  // OWASP's documented scrypt memory/parallelism alternative: N=2^14, r=8, p=5.
  const bytes = scryptSync(syntheticPassword, salt, 32, { N: 16384, r: 8, p: 5, maxmem: 64 * 1024 * 1024 });
  const elapsed = performance.now() - begin;
  return { algorithm: 'scrypt', N: 16384, r: 8, p: 5, wallMs: elapsed, outputBits: bytes.byteLength * 8 };
}

export class PasswordProbe {
  async fetch(request) {
    // Public requests can reach this class only through the guarded entry Worker.
    if (request.method !== 'POST') return json({ error: 'method' }, 405);
    const kind = new URL(request.url).searchParams.get('algorithm');
    if (kind === 'scrypt') return json(await measureScrypt());
    if (kind === 'pbkdf2') return json(await measurePbKdf2());
    return json({ error: 'algorithm' }, 400);
  }
}

export default {
  async fetch(request, env) {
    if (!authorized(request, env)) return json({ error: 'not-available' }, 404);
    if (request.method !== 'POST') return json({ error: 'method' }, 405);
    const path = new URL(request.url).pathname;
    try {
      if (path === '/__cf00/init') {
        await prepareFixture(env.DB);
        return json({ initialized: true });
      }
      if (path === '/__cf00/write') {
        const raw = await request.text();
        if (raw.length > 4096) return json({ error: 'payload-too-large' }, 413);
        const attempt = JSON.parse(raw);
        await commitSyntheticBatch(env.DB, attempt);
        return json({ committed: true, batchId: attempt.batchId });
      }
      if (path === '/__cf00/receipt') {
        const { batchId } = await request.json();
        const receipt = await readReceipt(env.DB, batchId);
        return json({ receipt });
      }
      if (path === '/__cf00/state') return json(await readSyntheticState(env.DB));
      if (path === '/__cf00/password') {
        const algorithm = new URL(request.url).searchParams.get('algorithm');
        const id = env.PASSWORD_PROBE.idFromName('cf00-only-password-benchmark');
        return env.PASSWORD_PROBE.get(id).fetch(new Request(`https://cf00.invalid/?algorithm=${algorithm}`, { method: 'POST' }));
      }
      return json({ error: 'route' }, 404);
    } catch (error) {
      return json({ error: error instanceof SyntaxError || error instanceof TypeError ? 'invalid-input' : 'conflict-or-unavailable' },
        error instanceof SyntaxError || error instanceof TypeError ? 400 : 409);
    }
  },
};
