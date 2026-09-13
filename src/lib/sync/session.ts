import { auth } from '../firebase';

let epoch = 0;

export function userOwner(uid: string): string {
    if (!uid) throw new Error('UID richiesto per la persistenza locale');
    return `user:${uid}`;
}

export function normalizeStorageOwner(owner: string): string {
    if (!owner) throw new Error('Owner richiesto per la persistenza locale');
    if (owner === 'guest' || owner.startsWith('user:')) return owner;
    return userOwner(owner);
}

export function storageOwner(): string {
    let guest = false;
    try { guest = localStorage.getItem('logbook_is_guest') === 'true'; } catch { /* No guest opt-in available. */ }
    return !guest && auth.currentUser?.uid ? userOwner(auth.currentUser.uid) : 'guest';
}
export const captureSession = () => ({ owner: storageOwner(), epoch });
export const isCurrentSession = (session: ReturnType<typeof captureSession>) => session.epoch === epoch && session.owner === storageOwner();
export const invalidateSession = () => { epoch += 1; };
