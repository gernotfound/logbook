/** Validate the canonical authenticated namespace before constructing storage keys. */
export function assertAuthenticatedOwner(owner: string): void {
    if (!owner.startsWith('user:') || owner.length <= 5 || owner.includes('/')) {
        throw new Error('Owner autenticato locale non valido');
    }
}

export function userOwner(uid: string): string {
    if (!uid) throw new Error('UID richiesto per la persistenza locale');
    const owner = `user:${uid}`;
    assertAuthenticatedOwner(owner);
    return owner;
}

export function normalizeStorageOwner(owner: string): string {
    if (!owner) throw new Error('Owner richiesto per la persistenza locale');
    if (owner === 'guest') return owner;
    if (owner.startsWith('user:')) {
        assertAuthenticatedOwner(owner);
        return owner;
    }
    return userOwner(owner);
}
