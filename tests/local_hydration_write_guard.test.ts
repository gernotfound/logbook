import { beforeEach, describe, expect, it } from 'vitest';
import { emptyUserData } from './setup';
import { hydrateLocal, initializeLocal, readLocal } from '../src/lib/sync/localRepository';
import type { UserData } from '../src/types';

function data(name: string): UserData {
    return {
        ...structuredClone(emptyUserData),
        profile: { ...emptyUserData.profile, name } as UserData['profile'],
    };
}

describe('local hydration write fencing', () => {
    beforeEach(() => localStorage.clear());

    it('does not let a stale hydration overwrite a newer durable envelope', async () => {
        const owner = 'user:hydration-fence';
        const newer = data('newer');
        const stale = data('stale');

        await initializeLocal(owner, newer, []);

        await expect(hydrateLocal(owner, stale, [], new Map(), 'all', () => false))
            .rejects.toThrow('Hydration locale invalidata o non riuscita');

        const envelope = await readLocal(owner);
        expect(envelope?.data.profile).toEqual(newer.profile);
        expect(envelope?.baseline.profile).toEqual(newer.profile);
    });
});
