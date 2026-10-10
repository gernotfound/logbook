import { doc, getDoc, setDoc, type Firestore } from 'firebase/firestore';
import type { ReplicaIdentity } from '../../src/lib/sync/replicaProtocol';
import type { VectorClock } from '../../src/lib/sync/semanticProjection';

// RulesTestEnvironment exposes the compat Firestore surface in its types.
// Its emulator database is already exercised with the modular API throughout
// these integration tests; this test-only adapter preserves the same instance.
export function asModularFirestore<T extends object>(emulatorDb: T): Firestore {
    return emulatorDb as unknown as Firestore;
}

export async function registerReplica(
    db: Firestore,
    uid: string,
    slot = 's00',
    replicaId = `replica-${slot}`,
    checkpointClock: VectorClock = {},
    lastSeq = 0,
): Promise<ReplicaIdentity> {
    const now = Date.now();
    const identity: ReplicaIdentity = {
        slot,
        replicaId,
        generation: 1,
        checkpointAtMs: now,
        leaseUntilMs: now + 360 * 24 * 60 * 60 * 1000,
    };
    const ref = doc(db, `users/${uid}/sync_control/state`);
    const snapshot = await getDoc(ref);
    const previous = snapshot.exists() ? snapshot.data() : undefined;
    await setDoc(ref, {
        protocolVersion: 3,
        replicas: {
            ...(previous?.replicas ?? {}),
            [slot]: {
                replicaId,
                generation: 1,
                status: 'active',
                lastSeq,
                checkpointAtMs: identity.checkpointAtMs,
                leaseUntilMs: identity.leaseUntilMs,
                checkpointClock,
            },
        },
        mutation: { slot, action: 'register' },
    });
    return identity;
}
