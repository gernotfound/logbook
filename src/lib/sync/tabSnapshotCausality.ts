import { UserDataSchema } from '../schema';
import type { UserData } from '../../types';
import type { SessionSnapshot } from './session';

type TabSnapshotState = {
    session: SessionSnapshot;
    base: UserData;
    dirty: boolean;
};

let snapshotState: TabSnapshotState | null = null;

const sameSession = (a: SessionSnapshot, b: SessionSnapshot): boolean =>
    a.owner === b.owner
    && a.epoch === b.epoch
    && a.guestSessionId === b.guestSessionId
    && a.consentMarker === b.consentMarker
    && a.consentGeneration === b.consentGeneration;

const clone = (data: UserData) => structuredClone(UserDataSchema.parse(data) as unknown as UserData);

export function markTabSnapshotClean(session: SessionSnapshot, data: UserData): void {
    snapshotState = { session: { ...session }, base: clone(data), dirty: false };
}

export function markTabSnapshotDirty(session: SessionSnapshot, base: UserData): void {
    if (snapshotState && !sameSession(snapshotState.session, session)) {
        // A stale in-memory snapshot cannot acquire the provenance of a new
        // consent or guest generation merely because an edit was attempted.
        // Hydration must first establish a verified clean baseline.
        throw new Error('Snapshot della scheda appartenente a una sessione precedente. Ricarica TheLogBook.');
    }
    if (snapshotState?.dirty) return;
    snapshotState = { session: { ...session }, base: clone(base), dirty: true };
}

export function readTabSnapshotState(session: SessionSnapshot): { base: UserData; dirty: boolean } | undefined {
    if (!snapshotState || !sameSession(snapshotState.session, session)) return undefined;
    return { base: clone(snapshotState.base), dirty: snapshotState.dirty };
}
