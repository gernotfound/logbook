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

    const install = (next: AuthenticatedIdentityReader): (() => void) => {
        if (typeof next !== 'function' || (reader !== null && reader !== next)) {
            throw new Error('Provider di identità già associato alla sessione corrente');
        }
        reader = next;
        // The disposer is used only at a full provider teardown. It cannot
        // remove a newer source and thereby resurrect an older owner.
        return () => {
            if (reader === next) reader = null;
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
