import { beforeEach, describe, expect, it } from 'vitest';
import { emptyUserData } from './setup';
import { hydrateLocal, initializeLocal, readLocal } from '../src/lib/sync/localRepository';
import type { UserData } from '../src/types';

function data(height: string): UserData {
    return {
        ...structuredClone(emptyUserData),
        profile: { ...emptyUserData.profile, height },
    };
}

describe('local hydration write fencing', () => {
    beforeEach(() => localStorage.clear());

    it('does not let a stale hydration overwrite a newer durable envelope', async () => {
        const owner = 'user:hydration-fence';
        const newer = data('182');
        const stale = data('171');

        await initializeLocal(owner, newer, []);

        await expect(hydrateLocal(owner, stale, [], new Map(), 'all', () => false))
            .rejects.toThrow('Hydration locale invalidata o non riuscita');

        const envelope = await readLocal(owner);
        expect(envelope?.data.profile.height).toBe('182');
        expect(envelope?.baseline.profile.height).toBe('182');
    });
});
