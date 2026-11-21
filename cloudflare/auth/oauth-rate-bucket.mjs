export const OAUTH_RATE_BUCKET_HEADER = 'x-logbook-oauth-bucket';

/** @param {string} value */
function networkBucket(value) {
  if (/^(?:0|[1-9]\d{0,2})(?:\.(?:0|[1-9]\d{0,2})){3}$/.test(value)) {
    return value.split('.').every(part => Number(part) <= 255) ? 'v4:' + value : null;
  }
  if (!value.includes(':') || !/^[\da-f:.]{2,45}$/i.test(value)) return null;
  try {
    const canonical = new URL('http://[' + value + ']/').hostname.slice(1, -1);
    const [left, right] = canonical.split('::');
    const prefix = left ? left.split(':') : [];
    const suffix = right ? right.split(':') : [];
    const groups = right === undefined ? prefix : [
      ...prefix, ...Array(8 - prefix.length - suffix.length).fill('0'), ...suffix,
    ];
    if (groups.slice(0, 6).join(':') === '0:0:0:0:0:ffff') {
      const high = Number.parseInt(groups[6], 16);
      const low = Number.parseInt(groups[7], 16);
      return 'v4:' + [high >>> 8, high & 255, low >>> 8, low & 255].join('.');
    }
    return 'v6:' + groups.slice(0, 4).join(':');
  } catch {
    return null;
  }
}

/** @param {Request & { cf?: unknown }} request */
export async function edgeOAuthRateBucket(request) {
  // Workers can change apparent client metadata on subrequests. Treat those
  // and requests lacking edge metadata as unattributed, in a separate budget.
  if (!request.cf || request.headers.has('cf-worker')) return null;
  const network = networkBucket(request.headers.get('cf-connecting-ip') ?? '');
  if (!network) return null;
  const input = new TextEncoder().encode('thelogbook:oauth-rate:v1:' + network);
  const digest = await crypto.subtle.digest('SHA-256', input);
  return Array.from(new Uint8Array(digest), byte => byte.toString(16).padStart(2, '0')).join('');
}

/** @param {Request} request */
export function privateOAuthRateKey(request) {
  const candidate = request.headers.get(OAUTH_RATE_BUCKET_HEADER);
  const bucket = candidate && /^[0-9a-f]{64}$/.test(candidate) ? candidate : 'unattributed';
  return 'oauth:' + (request.method === 'GET' ? 'callback:' : 'start:') + bucket;
}
