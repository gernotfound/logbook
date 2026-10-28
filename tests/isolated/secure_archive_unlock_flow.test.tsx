import { beforeEach, describe, expect, it, vi } from 'vitest';

const vault = vi.hoisted(() => ({ unlocked: false }));
vi.mock('../../src/lib/sync/secureArchiveSession', () => ({
    isVaultUnlocked: () => vault.unlocked,
    lockVault: () => { vault.unlocked = false; },
}));
vi.mock('../../src/lib/sync/secureArchiveMigration', () => ({
    createAndMigrateVault: vi.fn(),
}));
vi.mock('../../src/lib/sync/localPurgeFence', () => ({ isLocalPurgePending: () => false }));

import { createAndMigrateVault } from '../../src/lib/sync/secureArchiveMigration';
import {
    cancelLocalVaultReadiness, ensureLocalVaultReady,
} from '../../src/lib/sync/secureArchiveUnlockFlow';

const owner = 'user:readiness-race';
type ControlledAttempt = { finish: () => void; fail: () => void };
let attempts: ControlledAttempt[];

beforeEach(() => {
    vault.unlocked = false;
    attempts = [];
    vi.mocked(createAndMigrateVault).mockReset().mockImplementation((_owner, isCurrent) =>
        new Promise<void>((resolve, reject) => {
            attempts.push({
                finish: () => {
                    // Model the production unlock boundary: a cancelled request
                    // must not publish a capability after an asynchronous wait.
                    if (isCurrent?.() === false) {
                        reject(new Error('readiness cancelled'));
                        return;
                    }
                    vault.unlocked = true;
                    resolve();
                },
                fail: () => reject(new Error('storage unavailable')),
            });
        }),
    );
});

describe('cancelled secure archive readiness', () => {
    it('preserves a newer successful readiness when the old operation finishes last', async () => {
        const old = ensureLocalVaultReady(owner);
        cancelLocalVaultReadiness(owner);
        await old;
        const newer = ensureLocalVaultReady(owner);
        expect(attempts).toHaveLength(2);
        attempts[1].finish();
        await newer;
        expect(vault.unlocked).toBe(true);
        attempts[0].finish();
        await Promise.resolve();
        expect(vault.unlocked).toBe(true);
    });

    it('revokes a capability published immediately before cancellation', async () => {
        const pending = ensureLocalVaultReady(owner);
        attempts[0].finish();
        expect(vault.unlocked).toBe(true);
        cancelLocalVaultReadiness(owner);
        await pending;
        expect(vault.unlocked).toBe(false);
    });

    it('does not publish a capability from a cancelled request without a successor', async () => {
        const pending = ensureLocalVaultReady(owner);
        cancelLocalVaultReadiness(owner);
        await pending;
        attempts[0].finish();
        await Promise.resolve();
        expect(vault.unlocked).toBe(false);
    });

    it('does not leave an abandoned capability when both requests are cancelled', async () => {
        const old = ensureLocalVaultReady(owner);
        cancelLocalVaultReadiness(owner);
        await old;
        const newer = ensureLocalVaultReady(owner);
        cancelLocalVaultReadiness(owner);
        await newer;
        attempts[0].finish();
        attempts[1].fail();
        await Promise.resolve();
        expect(vault.unlocked).toBe(false);

        const recovered = ensureLocalVaultReady(owner);
        attempts[2].finish();
        await recovered;
        expect(vault.unlocked).toBe(true);
    });

    it('preserves an independently accepted fast-path readiness', async () => {
        const old = ensureLocalVaultReady(owner);
        cancelLocalVaultReadiness(owner);
        await old;
        vault.unlocked = true;
        await ensureLocalVaultReady(owner);
        attempts[0].finish();
        await Promise.resolve();
        expect(vault.unlocked).toBe(true);
    });

    it('does not revoke a successfully published key when another caller reuses the pending request', async () => {
        const first = ensureLocalVaultReady(owner);
        const second = ensureLocalVaultReady(owner);
        expect(second).toBe(first);
        expect(attempts).toHaveLength(1);
        attempts[0].finish();
        await first;
        expect(vault.unlocked).toBe(true);
    });
});
