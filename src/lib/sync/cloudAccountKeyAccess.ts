import { BACKEND_API_ORIGIN as API } from '../backendApi';
import { auth, ensureAppCheck } from '../firebase';
import { getLimitedUseAppCheckToken } from '../appCheck';
import { getVerifiedHealthConsentRevision, isHealthConsentCloudWritable } from '../healthConsent';
import { captureSessionForOwner, isCurrentSession, userOwner } from './session';

/**
 * Account Data Keys are ONLINE capabilities, not a second local archive key.
 * IndexedDB and the offline journal remain protected by their independent
 * device vault; retaining an ADK there serves no offline use case and would
 * create a stale-key/rotation hazard after health-data erasure.
 *
 * A fresh authenticated backend request is required for each cloud operation.
 * The caller may reuse the returned bytes only within that single operation,
 * after checking its captured Auth/session/consent fence.
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
    if (!uid || uid.includes('/') || auth.currentUser?.uid !== uid) {
        throw new CloudKeyAccessUnavailableError();
    }
    const owner = userOwner(uid);
    const session = captureSessionForOwner(owner);
    const consentRevision = purpose === 'sync' ? getVerifiedHealthConsentRevision(uid) : null;
    const checkCurrent = () => {
        assertCurrent();
        if (!isCurrentSession(session) || auth.currentUser?.uid !== uid) {
            throw new CloudKeyAccessUnavailableError();
        }
        if (purpose === 'sync' && (!isHealthConsentCloudWritable(owner)
            || getVerifiedHealthConsentRevision(uid) !== consentRevision)) {
            throw new CloudKeyAccessUnavailableError();
        }
    };

    checkCurrent();
    await ensureAppCheck();
    checkCurrent();
    const token = await getLimitedUseAppCheckToken();
    checkCurrent();
    const idToken = await auth.currentUser!.getIdToken();
    checkCurrent();

    let response: Response;
    try {
        response = await fetch(API + '/api/cloud-key' + (purpose === 'rights-export' ? '?purpose=rights-export' : ''), {
            method: 'POST',
            cache: 'no-store',
            signal: AbortSignal.timeout(12_000),
            headers: { authorization: 'Bearer ' + idToken, 'x-firebase-appcheck': token },
        });
    } catch {
        throw new CloudKeyAccessUnavailableError();
    }
    checkCurrent();
    if (!response.ok) throw new CloudKeyAccessUnavailableError();

    let payload: unknown;
    try { payload = await response.json(); } catch { throw new CloudKeyAccessUnavailableError(); }
    checkCurrent();
    if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
        throw new CloudKeyAccessUnavailableError();
    }
    const parsed = payload as Record<string, unknown>;
    if (Object.keys(parsed).sort().join(',') !== 'format,key,version'
        || parsed.format !== 'thelogbook-account-data-key' || parsed.version !== 1) {
        throw new CloudKeyAccessUnavailableError();
    }
    // Never persist a cloud key on the device; only the independent device
    // vault supports offline use. A failed post-decode fence wipes the bytes.
    const key = decodeKey(parsed.key);
    try {
        checkCurrent();
        return key;
    } catch (error) {
        key.fill(0);
        throw error;
    }
}

/** Normal sync requires an online server-confirmed consent revision. */
export function requireCloudAccountDataKey(uid: string, assertCurrent: () => void): Promise<Uint8Array> {
    return acquireAccountDataKey(uid, assertCurrent, 'sync');
}

/** Rights-only recovery after withdrawal never provisions keys or authorizes sync. */
export function requireRightsExportAccountDataKey(uid: string, assertCurrent: () => void): Promise<Uint8Array> {
    return acquireAccountDataKey(uid, assertCurrent, 'rights-export');
}
