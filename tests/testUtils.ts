import { DB as RealDB } from '../src/lib/db';
import { auth as __testAuth } from '../src/lib/firebase';
import {
    adoptReplicaCheckpoint as __testAdoptReplicaCheckpoint,
    commitLocal as __testCommitLocal,
    readLocal as __testReadLocal,
} from '../src/lib/sync/localRepository';

// Test-only fallback: production sync must not retain serialized UserData.
let lastSavedTestStateStr: string | null = null;

export const TestDB = {
    ...RealDB,
    resetCache: () => {
        lastSavedTestStateStr = null;
        RealDB.resetCache();
    },
    saveUserData: async (state: any, _rev?: any) => {
        const uid = __testAuth.currentUser?.uid;
        const owner = uid ? 'user:' + uid : 'guest';
        let durable = await __testReadLocal(owner);
        const oldState = durable?.data ?? (lastSavedTestStateStr ? JSON.parse(lastSavedTestStateStr) : {});
        await __testCommitLocal(owner, state, oldState);
        durable = await __testReadLocal(owner);
        if (uid && durable && !durable.replica) {
            const now = Date.now();
            await __testAdoptReplicaCheckpoint(owner, {
                identity: {
                    slot: 's00',
                    replicaId: 'test-replica',
                    generation: 1,
                    checkpointAtMs: now,
                    leaseUntilMs: now + 360 * 24 * 60 * 60 * 1000,
                },
                baseSeq: 0,
            }, { clock: {}, syncMetaByDocument: {} });
        }
        const result = await RealDB.saveUserData(state, _rev);
        if (uid && result.ok) lastSavedTestStateStr = JSON.stringify(state);
        return result;
    }
};

/** Explicitly consented account fixture for transport/stress tests, not production behavior. */
export const ConsentedTestDB = {
    ...TestDB,
    saveUserData: (state: any, revision?: any) => TestDB.saveUserData({
        ...state,
        // Tests outside the legal-consent suite exercise transport with a consented account.
        legalConsent: Object.prototype.hasOwnProperty.call(state ?? {}, 'legalConsent')
            ? state.legalConsent
            : {
                hasAcceptedTerms: true,
                hasAcceptedHealthData: true,
                acceptedAt: '2026-10-11T10:00:00.000Z',
                privacyVersion: '1.3.2',
                termsVersion: '1.2.0',
            },
    }, revision),
};
