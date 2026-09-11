import { auth } from '../firebase';

let epoch = 0;
export function storageOwner(): string {
    let guest = false;
    try { guest = localStorage.getItem('logbook_is_guest') === 'true'; } catch { /* No guest opt-in available. */ }
    return !guest && auth.currentUser?.uid ? `user:${auth.currentUser.uid}` : 'guest';
}
export const captureSession = () => ({ owner: storageOwner(), epoch });
export const isCurrentSession = (session: ReturnType<typeof captureSession>) => session.epoch === epoch && session.owner === storageOwner();
export const invalidateSession = () => { epoch += 1; };
