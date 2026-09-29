import { UserDataSchema } from '../schema';
import type { UserData } from '../../types';

type SessionIdentity = { owner: string; epoch: number };

type TabSnapshotState = {
    key: string;
    base: UserData;
    dirty: boolean;
};

let snapshotState: TabSnapshotState | null = null;

const keyFor = (session: SessionIdentity) => `${session.owner}\u0000${session.epoch}`;
const clone = (data: UserData) => structuredClone(UserDataSchema.parse(data) as unknown as UserData);

export function markTabSnapshotClean(session: SessionIdentity, data: UserData): void {
    snapshotState = { key: keyFor(session), base: clone(data), dirty: false };
}

export function markTabSnapshotDirty(session: SessionIdentity, base: UserData): void {
    const key = keyFor(session);
    if (snapshotState?.key === key && snapshotState.dirty) return;
    snapshotState = { key, base: clone(base), dirty: true };
}

export function readTabSnapshotState(session: SessionIdentity): { base: UserData; dirty: boolean } | undefined {
    if (!snapshotState || snapshotState.key !== keyFor(session)) return undefined;
    return { base: clone(snapshotState.base), dirty: snapshotState.dirty };
}
