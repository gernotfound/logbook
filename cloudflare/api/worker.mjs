// Candidate-only encrypted replica API. There is intentionally no public fixture,
// secret-header login, test backdoor or fallback identity when AUTH_GATE is absent.
import { z } from 'zod';
import { BODY_LIMIT_BYTES, BadInput, id, claimInput, retireInput, readInput, pageInput, commitInput, commitStatusInput, authClaims, uniquePaths, validateSealedBatch } from './replica-contracts.mjs';
import {
  requireCurrentIndependentSyncFence, RuntimeSyncAccessRevokedError,
} from '../recovery/runtime-sync-fence.mjs';
import consentWorker from './consent-worker.mjs';
import logoutWorker from './logout-worker.mjs';
import cloudKeyWorker from './cloud-key-worker.mjs';
import { commitEncryptedBatch, readAccessState, readCloudKeyPrecondition, readCommitOutcome, readDocumentPage, readReceipt, readReplicaControl, readRightsAccessState, readRightsDocumentPage, readSnapshot } from './d1-document-store.mjs';
import { requireIndependentOwnerFence } from '../recovery/independent-owner-fence.mjs';
import {
  mutationResponse, prepareReplicaClaim, prepareReplicaRetirement, readPublicCheckpointClock,
  readReplicaMutationReceipt, readReplicaMutationOutcome, writeReplicaMutation,
} from './replica-maintenance.mjs';

function reply(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status, headers: {
      'Content-Type': 'application/json; charset=utf-8',
      'Cache-Control': 'no-store',
      'X-Content-Type-Options': 'nosniff',
      'Referrer-Policy': 'no-referrer',
      'X-Robots-Tag': 'noindex, nofollow',
    },
  });
}

function checkJsonRequestHeaders(request, maxBytes) {
  if (!/^application\/json(?:\s*;|$)/i.test(request.headers.get('content-type') ?? '')) {
    throw new BadInput('unsupported-media-type', 415);
  }
  const declared = request.headers.get('content-length');
  if (declared && (!/^\d+$/.test(declared) || Number(declared) > maxBytes)) {
    throw new BadInput('payload-too-large', 413);
  }
}

async function jsonBounded(request, maxBytes) {
  checkJsonRequestHeaders(request, maxBytes);
  if (!request.body) throw new BadInput('invalid-json', 400);
  const reader = request.body.getReader();
  const parts = [];
  let size = 0;
  while (true) {
    const { value, done } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > maxBytes) {
      await reader.cancel().catch(() => {});
      throw new BadInput('payload-too-large', 413);
    }
    parts.push(value);
  }
  const bytes = new Uint8Array(size);
  let offset = 0;
  for (const part of parts) { bytes.set(part, offset); offset += part.byteLength; }
  try { return JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes)); }
  catch { throw new BadInput('invalid-json', 400); }
}

function canonical(value) {
  if (Array.isArray(value)) return '[' + value.map(canonical).join(',') + ']';
  if (value && typeof value === 'object') {
    return '{' + Object.keys(value).sort().map(k => JSON.stringify(k) + ':' + canonical(value[k])).join(',') + '}';
  }
  return JSON.stringify(value);
}
async function payloadHash(value) {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(canonical(value)));
  return Array.from(new Uint8Array(digest), b => b.toString(16).padStart(2, '0')).join('');
}

async function authorize(request, env, route, isMutation) {
  if (!env.AUTH_GATE || typeof env.AUTH_GATE.fetch !== 'function') {
    throw new BadInput('auth-unavailable', 503);
  }
  const headers = new Headers({
    'x-original-method': request.method,
    'x-original-route': route,
    'origin': request.headers.get('origin') ?? '',
    'cookie': request.headers.get('cookie') ?? '',
    'x-csrf-token': request.headers.get('x-csrf-token') ?? '',
  });
  let response;
  try {
    response = await env.AUTH_GATE.fetch(new Request('https://auth-gate.internal/__internal/authorize', { method: 'POST', headers }));
  } catch { throw new BadInput('auth-unavailable', 503); }
  if (response.status === 429) throw new BadInput('rate-limited', 429);
  if (response.status === 401 || response.status === 403) throw new BadInput('unauthorized', response.status);
  if (!response.ok) throw new BadInput('auth-unavailable', 503);
  let claims;
  try { claims = authClaims.parse(await response.json()); }
  catch { throw new BadInput('auth-unavailable', 503); }
  // Rights-only remains possible after losing email verification, but no
  // active-fitness route may inherit that weaker scope from the AuthGate.
  if (!claims.emailVerified && route !== '/v1/rights/scan') throw new BadInput('unauthorized', 403);
  if (isMutation && !claims.csrfVerified) throw new BadInput('csrf-required', 403);
  return claims;
}

async function handler(request, env) {
  const url = new URL(request.url);
  const route = url.pathname;
  const maxBytes = BODY_LIMIT_BYTES;

  if (route === '/v1/consent/status' || route === '/v1/consent/grant' || route === '/v1/consent/revoke') {
    return consentWorker(request, env, route);
  }
  if (route === '/v1/auth/logout') {
    return logoutWorker(request, env, route);
  }
  if (route === '/v1/cloud-key/status' || route === '/v1/cloud-key/rotate') {
    return cloudKeyWorker(request, env, route);
  }

  const isMutation = request.method === 'POST' || request.method === 'PUT' || request.method === 'DELETE';
  const claims = await authorize(request, env, route, isMutation);
  const userId = claims.sub;

  if (route === '/v1/replica/claim') {
    if (request.method !== 'POST') throw new BadInput('method-not-allowed', 405);
    const body = await jsonBounded(request, maxBytes);
    const input = claimInput.parse(body);
    await requireIndependentOwnerFence(env, userId);
    const result = await prepareReplicaClaim(env, userId, input);
    return reply(result);
  }

  if (route === '/v1/replica/retire') {
    if (request.method !== 'POST') throw new BadInput('method-not-allowed', 405);
    const body = await jsonBounded(request, maxBytes);
    const input = retireInput.parse(body);
    await requireIndependentOwnerFence(env, userId);
    const result = await prepareReplicaRetirement(env, userId, input);
    return reply(result);
  }

  if (route === '/v1/replica/mutation') {
    if (request.method !== 'POST') throw new BadInput('method-not-allowed', 405);
    const body = await jsonBounded(request, maxBytes);
    const input = mutationResponse.parse(body);
    await requireCurrentIndependentSyncFence(env, userId, input.replicaId);
    const result = await writeReplicaMutation(env, userId, input);
    return reply(result);
  }

  if (route === '/v1/replica/mutation-receipt') {
    if (request.method !== 'POST') throw new BadInput('method-not-allowed', 405);
    const body = await jsonBounded(request, maxBytes);
    const input = readInput.parse(body);
    await requireCurrentIndependentSyncFence(env, userId, input.replicaId);
    const result = await readReplicaMutationReceipt(env, userId, input);
    return reply(result);
  }

  if (route === '/v1/replica/mutation-outcome') {
    if (request.method !== 'POST') throw new BadInput('method-not-allowed', 405);
    const body = await jsonBounded(request, maxBytes);
    const input = readInput.parse(body);
    await requireCurrentIndependentSyncFence(env, userId, input.replicaId);
    const result = await readReplicaMutationOutcome(env, userId, input);
    return reply(result);
  }

  if (route === '/v1/replica/checkpoint-clock') {
    if (request.method !== 'POST') throw new BadInput('method-not-allowed', 405);
    const body = await jsonBounded(request, maxBytes);
    const input = readInput.parse(body);
    await requireCurrentIndependentSyncFence(env, userId, input.replicaId);
    const result = await readPublicCheckpointClock(env, userId, input);
    return reply(result);
  }

  if (route === '/v1/replica/access-state') {
    if (request.method !== 'POST') throw new BadInput('method-not-allowed', 405);
    const body = await jsonBounded(request, maxBytes);
    const input = readInput.parse(body);
    await requireCurrentIndependentSyncFence(env, userId, input.replicaId);
    const result = await readAccessState(env, userId, input);
    return reply(result);
  }

  if (route === '/v1/replica/control') {
    if (request.method !== 'POST') throw new BadInput('method-not-allowed', 405);
    const body = await jsonBounded(request, maxBytes);
    const input = readInput.parse(body);
    await requireCurrentIndependentSyncFence(env, userId, input.replicaId);
    const result = await readReplicaControl(env, userId, input);
    return reply(result);
  }

  if (route === '/v1/replica/snapshot') {
    if (request.method !== 'POST') throw new BadInput('method-not-allowed', 405);
    const body = await jsonBounded(request, maxBytes);
    const input = readInput.parse(body);
    await requireCurrentIndependentSyncFence(env, userId, input.replicaId);
    const result = await readSnapshot(env, userId, input);
    return reply(result);
  }

  if (route === '/v1/replica/document-page') {
    if (request.method !== 'POST') throw new BadInput('method-not-allowed', 405);
    const body = await jsonBounded(request, maxBytes);
    const input = pageInput.parse(body);
    await requireCurrentIndependentSyncFence(env, userId, input.replicaId);
    const result = await readDocumentPage(env, userId, input);
    return reply(result);
  }

  if (route === '/v1/replica/commit') {
    if (request.method !== 'POST') throw new BadInput('method-not-allowed', 405);
    const body = await jsonBounded(request, maxBytes);
    const input = commitInput.parse(body);
    await requireCurrentIndependentSyncFence(env, userId, input.replicaId);
    const result = await commitEncryptedBatch(env, userId, input);
    return reply(result);
  }

  if (route === '/v1/replica/commit-outcome') {
    if (request.method !== 'POST') throw new BadInput('method-not-allowed', 405);
    const body = await jsonBounded(request, maxBytes);
    const input = commitStatusInput.parse(body);
    await requireCurrentIndependentSyncFence(env, userId, input.replicaId);
    const result = await readCommitOutcome(env, userId, input);
    return reply(result);
  }

  if (route === '/v1/replica/receipt') {
    if (request.method !== 'POST') throw new BadInput('method-not-allowed', 405);
    const body = await jsonBounded(request, maxBytes);
    const input = readInput.parse(body);
    await requireCurrentIndependentSyncFence(env, userId, input.replicaId);
    const result = await readReceipt(env, userId, input);
    return reply(result);
  }

  if (route === '/v1/rights/scan') {
    if (request.method !== 'POST') throw new BadInput('method-not-allowed', 405);
    const body = await jsonBounded(request, maxBytes);
    const input = readInput.parse(body);
    const result = await readRightsAccessState(env, userId, input);
    return reply(result);
  }

  if (route === '/v1/rights/document-page') {
    if (request.method !== 'POST') throw new BadInput('method-not-allowed', 405);
    const body = await jsonBounded(request, maxBytes);
    const input = pageInput.parse(body);
    const result = await readRightsDocumentPage(env, userId, input);
    return reply(result);
  }

  throw new BadInput('not-found', 404);
}

export default {
  async fetch(request, env, ctx) {
    try {
      return await handler(request, env);
    } catch (err) {
      if (err instanceof BadInput) {
        return reply({ error: err.code }, err.status);
      }
      if (err instanceof RuntimeSyncAccessRevokedError) {
        return reply({ error: 'sync-access-revoked' }, 403);
      }
      return reply({ error: 'internal-error' }, 500);
    }
  },
};