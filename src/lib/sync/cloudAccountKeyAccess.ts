import { BACKEND_API_ORIGIN as API } from '../backendApi';
import { auth, ensureAppCheck } from '../firebase';
import { getLimitedUseAppCheckToken } from '../appCheck';
import { userOwner } from './owner';
import { readCachedAccountDataKey, rememberAccountDataKey } from './cloudAccountKeyCache';

/**
 * Lazy account-key acquisition. The caller MUST first establish the current
 * authenticated/consented cloud session; this is NOT a separate consent gate.
 *
 * Offline reopening uses the same device vault as local archive; on a fresh
 * device missing keys are acquired only over the authenticated backend.
 * Not wired to Firestore yet: activating this before the cutover is forbidden.
 */
export class CloudKeyAccessUnavailableError extends Error {
    readonly code = 'cloud-key-unavailable';
    constructor() {
        super('Chiave cloud temporaneamente non disponibile. I dati locali sono conservati.');
        this.name = 'CloudKeyAccessUnavailableError';
    }
}

function decodeKey(value: unknown): Uint8Array {
    if (typeof value !== 'string' || !/^[A-Za-z0-9+/]{43}=$/.test(value)) {
        throw new CloudKeyAccessUnavailableError();
    }
    try {
        const bytes = Uint8Array.from(atob(value), char => char.charCodeAt(0));
        if (bytes.length !== 32 || btoa(String.fromCharCode(...bytes)) !== value) {
            throw new CloudKeyAccessUnavailableError();
        }
        return bytes;
    } catch {
        throw new CloudKeyAccessUnavailableError();
    }
}

async function acquireAccountDataKey(
    uid: string, assertCurrent: () => void, purpose: 'sync' | 'rights-export',
): Promise<Uint8Array> {
    const user = auth.currentUser;
    if (!uid || uid.includes('/') || !user || user.uid !== uid) {
        throw new CloudKeyAccessUnavailableError();
    }
    const owner = userOwner(uid);
    assertCurrent();
    const cached = await readCachedAccountDataKey(owner);
    assertCurrent();
    if (cached) return cached;

    await ensureAppCheck();
    assertCurrent();
    const token = await getLimitedUseAppCheckToken();
    assertCurrent();
    const idToken = await user.getIdToken();
    assertCurrent();

    let response: Response;
    try {
        response = await fetch(API + '/api/cloud-key' + (purpose === 'rights-export' ? '?purpose=rights-export' : ''), {
            method: 'POST', cache: 'no-store', signal: AbortSignal.timeout(12_000),
            headers: { authorization: 'Bearer ' + idToken, 'x-firebase-appcheck': token },
        });
    } catch {
        throw new CloudKeyAccessUnavailableError();
    }
    assertCurrent();
    if (!response.ok) throw new CloudKeyAccessUnavailableError();

    let payload: unknown;
    try { payload = await response.json(); } catch { throw new CloudKeyAccessUnavailableError(); }
    assertCurrent();
    if (!payload || typeof payload !== 'object' || Array.isArray(payload)) throw new CloudKeyAccessUnavailableError();
    const parsed = payload as Record<string, unknown>;
    if (Object.keys(parsed).sort().join(',') !== 'format,key,version'
        || parsed.format !== 'thelogbook-account-data-key' || parsed.version !== 1) {
        throw new CloudKeyAccessUnavailableError();
    }
    const fresh = decodeKey(parsed.key);
    try {
        await rememberAccountDataKey(owner, fresh);
        assertCurrent();
        return fresh;
    } catch (error) {
        fresh.fill(0);
        throw error;
    }
}

/** Normal cloud operations require fresh authorized health consent. */
export function requireCloudAccountDataKey(uid: string, assertCurrent: () => void): Promise<Uint8Array> {
    return acquireAccountDataKey(uid, assertCurrent, 'sync');
}

/** Read-only capability for an explicit data export after consent withdrawal. */
export function requireRightsExportAccountDataKey(uid: string, assertCurrent: () => void): Promise<Uint8Array> {
    return acquireAccountDataKey(uid, assertCurrent, 'rights-export');
}
