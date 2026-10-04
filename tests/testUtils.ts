import { DB as RealDB } from '../src/lib/db';
import { auth as __testAuth } from '../src/lib/firebase';
import { dbState as __testDbState } from '../src/lib/db/db_core';
import {
    adoptReplicaCheckpoint as __testAdoptReplicaCheckpoint,
    commitLocal as __testCommitLocal,
    readLocal as __testReadLocal,
} from '../src/lib/sync/localRepository';

export const TestDB = {
    ...RealDB,
    saveUserData: async (state: any, _rev?: any) => {
        const uid = __testAuth.currentUser?.uid;
        const owner = uid ? 'user:' + uid : 'guest';
        let durable = await __testReadLocal(owner);
        const oldState = durable?.data ?? (__testDbState.lastSavedStateStr ? JSON.parse(__testDbState.lastSavedStateStr) : {});
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
        return RealDB.saveUserData(state, _rev);
    }
};
