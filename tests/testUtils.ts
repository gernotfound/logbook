import { DB as RealDB } from '../src/lib/db';
import { auth as __testAuth } from '../src/lib/firebase';
import { dbState as __testDbState } from '../src/lib/db/db_core';
import { commitLocal as __testCommitLocal } from '../src/lib/sync/localRepository';

export const TestDB = {
    ...RealDB,
    saveUserData: async (state: any, _rev?: any) => {
        let oldState = __testDbState.lastSavedStateStr ? JSON.parse(__testDbState.lastSavedStateStr) : {};
        const uid = __testAuth.currentUser?.uid;
        const owner = uid ? 'user:' + uid : 'guest';
        await __testCommitLocal(owner, state, oldState);
        return RealDB.saveUserData(state, _rev);
    }
};
