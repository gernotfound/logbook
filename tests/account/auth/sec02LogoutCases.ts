import { describe, it, expect, vi } from 'vitest';
import type { Sec02TestContext } from './sec02_logout_cleanup.test';
import type { UserData } from '../../../src/types';

export function registerSec02LogoutCases({
  DB, idb, storageOwner, isLocalPurgePending, localRepository,
  initializeLocal, UserDataSchema, idbStore, markAccountDeletion,
  isAccountDeletionPending,
}: Sec02TestContext): void {
  describe('guarded logout and consent/deletion fences', () => {
    it('also refuses a direct ordinary authenticated purge with a pending journal', async () => {
        const read = vi.spyOn(localRepository, 'readLocal').mockResolvedValue({ pending: [{ seq: 1 }] } as any);
        try {
            await expect(DB.purgeAllLocalUserData(storageOwner())).rejects.toThrow('modifiche');
            expect(idb.del).not.toHaveBeenCalled();
            expect(isLocalPurgePending(storageOwner())).toBe(false);
        } finally { read.mockRestore(); }
    });

    it('rejects an ordinary authenticated logout when the durable journal has pending operations', async () => {
        const { auth } = await import('../../../src/lib/firebase');
        const read = vi.spyOn(localRepository, 'readLocal').mockResolvedValue({ pending: [{ seq: 1 }] } as any);
        try {
            await expect(DB.secureLogOut()).rejects.toThrow('modifiche');
            expect(auth.signOut).not.toHaveBeenCalled();
            expect(idb.del).not.toHaveBeenCalled();
            expect(isLocalPurgePending(storageOwner())).toBe(false);
        } finally { read.mockRestore(); }
    });

    it('allows explicitly discarded pending changes but still completes the fenced sign-out', async () => {
        const { auth } = await import('../../../src/lib/firebase');
        const read = vi.spyOn(localRepository, 'readLocal').mockResolvedValue({ pending: [{ seq: 1 }] } as any);
        try {
            await DB.secureLogOut({ discardUnsynced: true });
            expect(auth.signOut).toHaveBeenCalledTimes(1);
            expect(idb.del).toHaveBeenCalledWith('logbook:v2:' + storageOwner());
            expect(isLocalPurgePending(storageOwner())).toBe(true);
        } finally { read.mockRestore(); }
    });

    it('never signs out or purges a different account than the requester', async () => {
        const { auth } = await import('../../../src/lib/firebase');
        await expect(DB.secureLogOut({ expectedUid: 'another-account' })).rejects.toThrow('sessione non valida');
        expect(auth.signOut).not.toHaveBeenCalled();
        expect(idb.del).not.toHaveBeenCalled();
    });

    it('restores write access when Firebase sign-out fails before deleting anything', async () => {
        const { auth } = await import('../../../src/lib/firebase');
        vi.mocked(auth.signOut).mockRejectedValueOnce(new Error('Network offline'));
        await expect(DB.secureLogOut()).rejects.toThrow('Network offline');
        expect(idb.del).not.toHaveBeenCalled();
        expect(isLocalPurgePending(storageOwner())).toBe(false);
    });

    it('rechecks the journal after pending UI drafts have flushed', async () => {
        const { auth } = await import('../../../src/lib/firebase');
        const read = vi.spyOn(localRepository, 'readLocal').mockResolvedValue({ pending: [{ seq: 2 }] } as any);
        const verifyCurrentDrafts = vi.fn(async () => undefined);
        try {
            await expect(DB.secureLogOut({ verifyCurrentDrafts })).rejects.toThrow('modifiche');
            expect(verifyCurrentDrafts).toHaveBeenCalledTimes(1);
            expect(auth.signOut).not.toHaveBeenCalled();
        } finally { read.mockRestore(); }
    });

    it('keeps a pending cloud withdrawal and archive intact before any account sign-out or ordinary purge', async () => {
        const { auth } = await import('../../../src/lib/firebase');
        const owner = storageOwner();
        expect(owner.startsWith('user:')).toBe(true);
        const marker = `logbook:v2:${owner}:health-consent-withdrawal`;
        localStorage.setItem(marker, 'pending:0');
        const purgeSpy = vi.spyOn(DB, 'purgeAllLocalUserData');

        await expect(DB.secureLogOut()).rejects.toThrow('non è ancora riconciliata');
        await expect(DB.purgeAllLocalUserData(owner)).rejects.toThrow('non è ancora riconciliata');
        expect(auth.signOut).not.toHaveBeenCalled();
        expect(idb.del).not.toHaveBeenCalled();
        expect(purgeSpy).toHaveBeenCalledTimes(1);
        expect(localStorage.getItem(marker)).toBe('pending:0');
        purgeSpy.mockRestore();
    });

    it('accepts a verified positive consent generation when the journal is clean', async () => {
        const { auth } = await import('../../../src/lib/firebase');
        const owner = storageOwner();
        const read = vi.spyOn(localRepository, 'readLocal').mockResolvedValue({
            pending: [], consentRevision: 12,
        } as any);
        localStorage.setItem(`logbook:v2:${owner}:health-consent-generation`, '12');

        try {
            await DB.secureLogOut();
            expect(auth.signOut).toHaveBeenCalledTimes(1);
            expect(idb.del).toHaveBeenCalledWith('logbook:v2:' + owner);
        } finally {
            read.mockRestore();
        }
    });

    it('rejects malformed and unsafe consent revisions without sign-out or purge', async () => {
        const { auth } = await import('../../../src/lib/firebase');
        const owner = storageOwner();
        const key = `logbook:v2:${owner}:health-consent-generation`;
        for (const revision of ['0', '01', '1junk', '9007199254740992']) {
            localStorage.setItem(key, revision);
            await expect(DB.secureLogOut({ discardUnsynced: true }))
                .rejects.toThrow('non è ancora riconciliata');
            expect(auth.signOut).not.toHaveBeenCalled();
            expect(idb.del).not.toHaveBeenCalled();
            expect(localStorage.getItem(key)).toBe(revision);
            expect(isLocalPurgePending(owner)).toBe(false);
        }
    });

    it('preserves a previous-epoch pending journal even if forced logout is requested', async () => {
        const { auth } = await import('../../../src/lib/firebase');
        const owner = storageOwner();
        const key = `logbook:v2:${owner}:health-consent-generation`;
        localStorage.setItem(key, '2');
        const read = vi.spyOn(localRepository, 'readLocal').mockResolvedValue({
            pending: [{ seq: 1 }], consentRevision: 1,
        } as any);

        try {
            await expect(DB.secureLogOut({ discardUnsynced: true }))
                .rejects.toThrow('non è ancora riconciliata');
            expect(auth.signOut).not.toHaveBeenCalled();
            expect(idb.del).not.toHaveBeenCalled();
            expect(localStorage.getItem(key)).toBe('2');
            expect(isLocalPurgePending(owner)).toBe(false);
        } finally {
            read.mockRestore();
        }
    });

    it('keeps a clean account intact if another tab withdraws consent during the journal read', async () => {
        const { auth } = await import('../../../src/lib/firebase');
        const owner = storageOwner();
        const marker = `logbook:v2:${owner}:health-consent-withdrawal`;
        localStorage.setItem(`logbook:v2:${owner}:health-consent-generation`, '2');
        let resolveRead!: (value: Awaited<ReturnType<typeof localRepository.readLocal>>) => void;
        const read = vi.spyOn(localRepository, 'readLocal').mockImplementationOnce(
            () => new Promise<Awaited<ReturnType<typeof localRepository.readLocal>>>(
                resolve => { resolveRead = resolve; },
            ),
        );
        try {
            const logout = DB.secureLogOut();
            await vi.waitFor(() => expect(read).toHaveBeenCalledTimes(1));
            localStorage.setItem(marker, 'pending:2');
            resolveRead(undefined);
            await expect(logout).rejects.toThrow('non è ancora riconciliata');
            expect(auth.signOut).not.toHaveBeenCalled();
            expect(idb.del).not.toHaveBeenCalled();
            expect(localStorage.getItem(marker)).toBe('pending:2');
            expect(isLocalPurgePending(owner)).toBe(false);
        } finally {
            read.mockRestore();
        }
    });

    it('allows an ordinary logout after server-confirmed withdrawal', async () => {
        const { auth } = await import('../../../src/lib/firebase');
        const owner = storageOwner();
        expect(owner.startsWith('user:')).toBe(true);
        localStorage.setItem(`logbook:v2:${owner}:health-consent-withdrawal`, 'withdrawn');
        await DB.secureLogOut();
        expect(auth.signOut).toHaveBeenCalledTimes(1);
        expect(idb.del).toHaveBeenCalledWith(`logbook:v2:${owner}`);
    });

    it('secureLogOut removes the account-deletion recovery credential only after local purge succeeds', async () => {
        const recoveryKey = 'logbook_deletion_recovery_devices_v1';
        const owner = storageOwner();
        const uid = owner.startsWith('user:') ? owner.slice('user:'.length) : 'unexpected-guest';
        localStorage.setItem(recoveryKey, JSON.stringify([{ uid, token: 'A'.repeat(43) }]));

        await DB.secureLogOut();

        expect(localStorage.getItem(recoveryKey)).toBeNull();
    });

    it('secureLogOut preserves the recovery credential if local purge fails after sign-out', async () => {
        const recoveryKey = 'logbook_deletion_recovery_devices_v1';
        const owner = storageOwner();
        const uid = owner.startsWith('user:') ? owner.slice('user:'.length) : 'unexpected-guest';
        localStorage.setItem(recoveryKey, JSON.stringify([{ uid, token: 'A'.repeat(43) }]));
        // The guarded logout owns the purge directly under the Web Lock; fail
        // its actual IndexedDB deletion boundary instead of spying on the old hook.
        vi.mocked(idb.del).mockRejectedValueOnce(new Error('local purge failed'));

        await expect(DB.secureLogOut()).rejects.toThrow('Pulizia locale incompleta');
        expect(localStorage.getItem(recoveryKey)).not.toBeNull();
        expect(isLocalPurgePending(owner)).toBe(true);
    });

    it('secureLogOut preserves the local archive and rejects when auth.signOut fails', async () => {
        const { auth } = await import('../../../src/lib/firebase');
        const owner = storageOwner();
        await initializeLocal(owner, UserDataSchema.parse({ profile: { height: '175' } }) as unknown as UserData);
        const ciphertext = idbStore['logbook:v2:' + owner];
        expect(ciphertext).toMatch(/^tlb-sealed:v1:/);
        vi.mocked(auth.signOut).mockRejectedValueOnce(new Error('Network offline'));

        await expect(DB.secureLogOut()).rejects.toThrow('Network offline');
        expect(idb.del).not.toHaveBeenCalled();
        expect(isLocalPurgePending(owner)).toBe(false);
        expect(idbStore['logbook:v2:' + owner]).toBe(ciphertext);
    });


    it('refuses authenticated logout before signOut when a deletion receipt is pending', async () => {
        const owner = storageOwner();
        expect(owner.startsWith('user:')).toBe(true);
        markAccountDeletion(owner, { receiptToken: 'A'.repeat(43), serverAcceptedAt: Date.now() });
        localStorage.setItem('logbook:v2:' + owner + ':workout', 'recoverable');

        await expect(DB.secureLogOut()).rejects.toThrow('Cancellazione account in sospeso');

        const { auth } = await import('../../../src/lib/firebase');
        expect(auth.signOut).not.toHaveBeenCalled();
        expect(idb.del).not.toHaveBeenCalled();
        expect(isAccountDeletionPending(owner)).toBe(true);
        expect(localStorage.getItem('logbook:v2:' + owner + ':workout')).toBe('recoverable');
    });
  });
}
