export function userOwner(uid: string): string {
    if (!uid) throw new Error('UID richiesto per la persistenza locale');
    return `user:${uid}`;
}

export function normalizeStorageOwner(owner: string): string {
    if (!owner) throw new Error('Owner richiesto per la persistenza locale');
    if (owner === 'guest' || owner.startsWith('user:')) return owner;
    return userOwner(owner);
}
