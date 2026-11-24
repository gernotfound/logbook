import { deriveKindeOwnerId, validKindeIssuer } from '../auth/kinde-owner-id.mjs';

const MANAGEMENT_HOST = /^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?\.kinde\.com$/;
const MAX_ACK_BYTES = 2048;

/** @param {Response} response */
async function hasDeletionAcknowledgement(response) {
  if (response.status !== 200 || response.redirected
    || response.headers.get('content-type')?.split(';')[0].trim().toLowerCase() !== 'application/json'
    || !response.body) {
    await response.body?.cancel();
    return false;
  }
  const reader = response.body.getReader();
  const decoder = new TextDecoder('utf-8', { fatal: true });
  let received = 0;
  let json = '';
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      received += value.byteLength;
      if (received > MAX_ACK_BYTES) return false;
      json += decoder.decode(value, { stream: true });
    }
    const body = JSON.parse(json + decoder.decode());
    return body?.code === 'OK' && typeof body.message === 'string';
  } finally {
    await reader.cancel().catch(() => {});
  }
}

/**
 * Candidate Management API transport. An acknowledgement is evidence about
 * the provider request only. It is not a durable account erasure receipt.
 * The job must independently prove the application erasure and hold its
 * terminal fence immediately before the outbound request.
 *
 * @param {{
 *   issuer: string,
 *   fetchImpl: typeof fetch,
 *   proveTerminalFence: (uid: string) => Promise<boolean>,
 * }} configuration
 */
export function createKindeErasureManagement({ issuer, fetchImpl, proveTerminalFence }) {
  if (!validKindeIssuer(issuer) || !MANAGEMENT_HOST.test(new URL(issuer).hostname)
    || typeof fetchImpl !== 'function' || typeof proveTerminalFence !== 'function') {
    throw new Error('kinde-erasure-management-unavailable');
  }
  /**
   * @param {{uid: string, subject: string, accessToken: string}} target
   * @returns {Promise<'withheld' | 'acknowledged' | 'unconfirmed'>}
   */
  return async function requestKindeErasure({ uid, subject, accessToken }) {
    let request;
    try {
      if (await deriveKindeOwnerId(issuer, subject) !== uid
        || typeof accessToken !== 'string' || accessToken.length > 8192
        || !/^[A-Za-z0-9._~-]+$/.test(accessToken)) return 'withheld';
      const url = new URL('/api/v1/user', issuer);
      url.searchParams.set('id', subject);
      url.searchParams.set('is_delete_profile', 'true');
      if (await proveTerminalFence(uid) !== true) return 'withheld';
      request = new Request(url, {
        method: 'DELETE',
        headers: { Authorization: 'Bearer ' + accessToken, Accept: 'application/json' },
        redirect: 'error',
        signal: AbortSignal.timeout(5000),
      });
    } catch { return 'withheld'; }

    try {
      const response = await fetchImpl(request);
      return await hasDeletionAcknowledgement(response) ? 'acknowledged' : 'unconfirmed';
    } catch {
      // Provider timeout, malformed responses and lost replies cannot prove
      // absence. The caller must reconcile from independent provider evidence.
      return 'unconfirmed';
    }
  };
}
