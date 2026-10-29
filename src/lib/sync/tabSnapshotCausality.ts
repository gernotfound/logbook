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
    if (snapshotState?.dirty
        && snapshotState.session.owner === session.owner
        && snapshotState.session.epoch === session.epoch
        && !sameSession(snapshotState.session, session)) {
        // Never re-label unsaved intent from an earlier consent/guest generation.
        // A clean tab may re-establish a base after explicit consent acceptance;
        // a genuine login/logout also activates a different realm epoch.
        throw new Error('Snapshot della scheda appartenente a una sessione precedente. Ricarica TheLogBook.');
    }
    if (snapshotState?.dirty) return;
    snapshotState = { session: { ...session }, base: clone(base), dirty: true };
}

export function readTabSnapshotState(session: SessionSnapshot): { base: UserData; dirty: boolean } | undefined {
    if (!snapshotState || !sameSession(snapshotState.session, session)) return undefined;
    return { base: clone(snapshotState.base), dirty: snapshotState.dirty };
}
