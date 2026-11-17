import { trustedBackendUrl } from '../backendApi';
import { auth, ensureAppCheck } from '../firebase';
import { getLimitedUseAppCheckToken } from '../appCheck';
import { getVerifiedHealthConsentRevision, isHealthConsentCloudWritable } from '../healthConsent';
import { captureSessionForOwner, isCurrentSession, userOwner } from './session';
import { CloudKeyAccessUnavailableError, decodeCloudAccountKey, isRetryableCloudKeyTransportFailure } from './cloudAccountKeyMaterial';

export { CloudKeyAccessUnavailableError } from './cloudAccountKeyMaterial';

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
    let token: string;
    let idToken: string;
    try {
        token = await getLimitedUseAppCheckToken();
        checkCurrent();
        idToken = await auth.currentUser!.getIdToken();
    } catch (error) {
        checkCurrent();
        throw error;
    }
    checkCurrent();

    // Configuration failures are not network outages and must stay fail-closed.
    const url = trustedBackendUrl('/api/cloud-key') + (purpose === 'rights-export' ? '?purpose=rights-export' : '');
    let response: Response;
    try {
        response = await fetch(url, {
            method: 'POST',
            cache: 'no-store',
            signal: AbortSignal.timeout(12_000),
            headers: { authorization: 'Bearer ' + idToken, 'x-firebase-appcheck': token },
        });
    } catch (error) {
        checkCurrent();
        throw new CloudKeyAccessUnavailableError(isRetryableCloudKeyTransportFailure(error));
    }
    checkCurrent();
    if (!response.ok) {
        throw new CloudKeyAccessUnavailableError([408, 429, 500, 502, 503, 504].includes(response.status));
    }

    let payload: unknown;
    try { payload = await response.json(); } catch (error) {
        checkCurrent();
        throw new CloudKeyAccessUnavailableError(isRetryableCloudKeyTransportFailure(error));
    }
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
    const key = decodeCloudAccountKey(parsed.key);
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
