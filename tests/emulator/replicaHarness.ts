import { doc, getDoc, setDoc, type Firestore } from 'firebase/firestore';
import type { RulesTestEnvironment } from '@firebase/rules-unit-testing';

/** Test-only Firebase Admin fixture. A normal client cannot write this proof. */
export async function seedTrustedConsent(env: RulesTestEnvironment, uid = 'a', revision = 1): Promise<void> {
    await env.withSecurityRulesDisabled(async context => {
        await setDoc(doc(asModularFirestore(context.firestore()), `health_consent_withdrawals/${uid}`), {
            uid, status: 'active', revision,
            privacyVersion: '1.3.4', termsVersion: '1.2.1',
            acceptedAt: '2026-10-13T00:00:00.000Z',
        });
    });
}
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
        consentRevision: 1,
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
