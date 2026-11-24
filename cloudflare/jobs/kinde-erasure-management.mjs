import { deriveKindeOwnerId, validKindeIssuer } from '../auth/kinde-owner-id.mjs';

const MANAGEMENT_HOST = /^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?\.kinde\.com$/;
const MAX_ACK_BYTES = 2048;
const MAX_PROFILE_LOOKUP_BYTES = 16 * 1024;

/** @param {Response} response @param {number} maxBytes */
async function readManagementResponse(response, maxBytes) {
  if (response.status !== 200 || response.redirected
    || response.headers.get('content-type')?.split(';')[0].trim().toLowerCase() !== 'application/json'
    || !response.body) {
    await response.body?.cancel();
    return null;
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
      if (received > maxBytes) return null;
      json += decoder.decode(value, { stream: true });
    }
    const body = JSON.parse(json + decoder.decode());
    return body?.code === 'OK' && typeof body.message === 'string' ? body : null;
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
   * @param {'DELETE' | 'GET'} method
   */
  async function authorizedRequest({ uid, subject, accessToken }, method) {
    try {
      if (await deriveKindeOwnerId(issuer, subject) !== uid
        || typeof accessToken !== 'string' || accessToken.length > 8192
        || !/^[A-Za-z0-9._~-]+$/.test(accessToken)) return null;
      const url = new URL(method === 'DELETE' ? '/api/v1/user' : '/api/v1/users', issuer);
      if (method === 'DELETE') {
        url.searchParams.set('id', subject);
        url.searchParams.set('is_delete_profile', 'true');
      } else {
        url.searchParams.set('user_id', subject);
        url.searchParams.set('page_size', '1');
      }
      if (await proveTerminalFence(uid) !== true) return null;
      return new Request(url, {
        method,
        headers: { Authorization: 'Bearer ' + accessToken, Accept: 'application/json' },
        cache: 'no-store',
        // Workers supports manual redirects. Never forward authorization to
        // a redirect target, and treat the 3xx response as unconfirmed.
        redirect: 'manual',
        signal: AbortSignal.timeout(5000),
      });
    } catch { return null; }
  }

  return {
    /** @param {Parameters<typeof authorizedRequest>[0]} target */
    async requestErasure(target) {
      const request = await authorizedRequest(target, 'DELETE');
      if (!request) return 'withheld';
      try {
        return await readManagementResponse(await fetchImpl(request), MAX_ACK_BYTES)
          ? 'acknowledged' : 'unconfirmed';
      } catch { return 'unconfirmed'; }
    },
    /** @param {Parameters<typeof authorizedRequest>[0]} target */
    async readPresence(target) {
      const request = await authorizedRequest(target, 'GET');
      if (!request) return 'withheld';
      try {
        const profile = await readManagementResponse(await fetchImpl(request), MAX_PROFILE_LOOKUP_BYTES);
        if (!Array.isArray(profile?.users)) return 'unconfirmed';
        if (profile.users.length === 1 && profile.users[0]?.id === target.subject) return 'present';
        // Only an exhausted, exact-ID filtered result proves lookup absence.
        // The job still needs recorded pre-delete presence and app erasure.
        return profile.users.length === 0 && (profile.next_token == null || profile.next_token === '')
          ? 'absent' : 'unconfirmed';
      } catch { return 'unconfirmed'; }
    },
  };
}
