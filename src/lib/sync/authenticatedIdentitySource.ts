/** A single provider owns the realm's authenticated identity source.
 *
 * The local owner is a storage namespace, NOT an authentication claim.
 * A Kinde implementation must be installed only after the legacy Firebase
 * provider is retired and must independently enforce its cookie/session
 * continuity before permitting any account vault or cloud operations.
 */
export type AuthenticatedIdentityReader = () => { readonly uid: unknown } | null;

export function createAuthenticatedIdentitySource() {
    let reader: AuthenticatedIdentityReader | null = null;
    let leases = 0;

    const install = (next: AuthenticatedIdentityReader): (() => void) => {
        if (typeof next !== 'function' || (reader !== null && reader !== next)) {
            throw new Error('Provider di identità già associato alla sessione corrente');
        }
        reader = next;
        leases += 1;
        let disposed = false;
        return () => {
            if (disposed) return;
            disposed = true;
            // Two mounts of the same provider may coexist during React
            // transitions. One cleanup must not revoke the other mount's
            // active reader; a stale disposer cannot remove a replacement.
            if (reader !== next) return;
            leases -= 1;
            if (leases === 0) reader = null;
        };
    };

    const readUid = (): string | null => {
        if (reader === null) return null;
        const identity = reader();
        if (identity === null) return null;
        if (!identity || typeof identity.uid !== 'string'
            || identity.uid.length === 0 || identity.uid.includes('/')) {
            throw new Error('Identità autenticata non valida');
        }
        return identity.uid;
    };

    return { install, readUid };
}

export const authenticatedIdentitySource = createAuthenticatedIdentitySource();

/**
 * Checks only whether a registered provider still names the same storage owner.
 * This is NOT a session grant or permission to ACK: callers must also fence the
 * captured session, consent revision and cloud operation separately.
 */
export function matchesAuthenticatedOwner(
    owner: string,
    readUid: () => string | null = authenticatedIdentitySource.readUid,
): boolean {
    if (!owner.startsWith('user:') || owner.length === 5) return false;
    try { return readUid() === owner.slice(5); }
    catch { return false; }
}
