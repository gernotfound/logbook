import 'fake-indexeddb/auto';
import { clear, get } from 'idb-keyval';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { UserDataSchema } from '../../src/lib/schema';
import type { UserData } from '../../src/types';
import {
    ensureBoundedPendingSequences,
    initializeLocal,
    readLocal,
} from '../../src/lib/sync/localRepository';
import type { LocalEnvelope } from '../../src/lib/sync/localEnvelopeValidation';
import type { SemanticOperation } from '../../src/lib/sync/semanticProjection';
import { createAndMigrateVault } from '../../src/lib/sync/secureArchiveMigration';
import { lockAllVaults } from '../../src/lib/sync/secureArchiveSession';
import * as archiveRepository from '../../src/lib/sync/secureArchiveRepository';
import { updateArchiveRecord } from '../../src/lib/sync/secureArchiveRepository';
import { MAX_SYNC_DOCUMENTS_PER_TRANSACTION } from '../../src/lib/sync/syncBatching';

const data = UserDataSchema.parse({ profile: { height: '170' } }) as unknown as UserData;
const storageKey = (owner: string) => 'logbook:v2:user:' + owner;

function operation(docPath: string, seq: number, actorId = 's00'): SemanticOperation {
    return {
        docPath, path: ['value'], isDelete: false, value: docPath,
        actorId, seq, clock: { [actorId]: seq },
    };
}

async function installOversizedJournal(owner: string): Promise<LocalEnvelope> {
    await createAndMigrateVault('user:' + owner);
    await initializeLocal(owner, data);
    const initial = await readLocal(owner);
    if (!initial) throw new Error('Expected a durable local envelope');
    const pending = [
        ...Array.from({ length: MAX_SYNC_DOCUMENTS_PER_TRANSACTION + 1 }, (_, index) =>
            operation(`history_months/2025-${String(index + 1).padStart(2, '0')}`, 5)),
        operation('nutrition_months/2026-01', 6),
    ];
    const stored: LocalEnvelope = {
        ...initial,
        actorId: 's00',
        actorSeq: 6,
        clock: { s00: 6, s01: 3 },
        pending,
        revision: initial.revision + 1,
    };
    await updateArchiveRecord<LocalEnvelope>('user:' + owner, () => stored);
    expect(await get(storageKey(owner))).toMatch(/^tlb-sealed:v1:/);
    return stored;
}


function changeAfterObservedRead(change: (current: LocalEnvelope) => LocalEnvelope) {
    const state: { envelope?: LocalEnvelope; ciphertext?: unknown } = {};
    const read = archiveRepository.getArchiveRecord;
    // Return the real earlier read after another tab's durable write. The
    // production update must re-read and validate the actual encrypted record.
    vi.spyOn(archiveRepository, 'getArchiveRecord').mockImplementationOnce(
        async <T>(owner: string): Promise<T | undefined> => {
            const observed = await read<T>(owner);
            await updateArchiveRecord<LocalEnvelope>(owner, current => {
                if (!current) throw new Error('Expected an archive for the concurrent writer');
                state.envelope = change(current);
                return state.envelope;
            });
            state.ciphertext = await get('logbook:v2:' + owner);
            return observed;
        },
    );
    return state;
}

beforeEach(async () => {
    lockAllVaults();
    localStorage.clear();
    await clear();
    vi.stubGlobal('navigator', { locks: {
        request: async (_name: string, _options: unknown, run: () => Promise<unknown>) => run(),
    } });
});
afterEach(() => {
    vi.restoreAllMocks();
    lockAllVaults();
    vi.unstubAllGlobals();
});

describe('bounded pending journal compaction', () => {
    it('rechecks and atomically splits a large causal sequence without dropping later work', async () => {
        const before = await installOversizedJournal('a');

        const after = await ensureBoundedPendingSequences('a', 's00');

        expect(after?.pending).toHaveLength(before.pending.length);
        expect(after?.pending.filter(op => op.seq === 5)).toHaveLength(MAX_SYNC_DOCUMENTS_PER_TRANSACTION);
        expect(after?.pending.filter(op => op.seq === 6)).toHaveLength(1);
        expect(after?.pending.filter(op => op.seq === 7)).toEqual([
            expect.objectContaining({ docPath: 'nutrition_months/2026-01' }),
        ]);
        expect(after?.actorSeq).toBe(7);
        expect(after?.clock).toEqual({ s00: 7, s01: 3 });
        expect(after?.revision).toBe(before.revision + 1);
        expect(after?.data).toEqual(before.data);
        expect(after?.baseline).toEqual(before.baseline);
        expect(after?.syncMetaByDocument).toEqual(before.syncMetaByDocument);
        expect(await readLocal('a')).toEqual(after);
    });

    it('rejects a stale session at the atomic resequencing boundary without touching encrypted pending work', async () => {
        const before = await installOversizedJournal('a');
        const encrypted = await get(storageKey('a'));
        let checks = 0;
        await expect(ensureBoundedPendingSequences('a', 's00', () => ++checks === 1))
            .rejects.toThrow('Sequenze journal invalidate dal cambio sessione');
        expect(checks).toBe(2);
        expect(await get(storageKey('a'))).toBe(encrypted);
        expect(await readLocal('a')).toEqual(before);

        const recovered = await ensureBoundedPendingSequences('a', 's00', () => true);
        expect(recovered?.pending.length).toBe(before.pending.length);
        expect(recovered?.revision).toBe(before.revision + 1);
    });

    it('is idempotent once bounded, preserving the durable envelope and revision', async () => {
        await installOversizedJournal('a');
        const first = await ensureBoundedPendingSequences('a', 's00');
        const persisted = await get(storageKey('a'));
        expect(persisted).toMatch(/^tlb-sealed:v1:/);

        expect(await ensureBoundedPendingSequences('a', 's00')).toEqual(first);
        expect(await get(storageKey('a'))).toEqual(persisted);
    });

    it('does not mutate a journal from another actor or owner', async () => {
        const beforeA = await installOversizedJournal('a');
        await createAndMigrateVault('user:b');
        await initializeLocal('b', data);
        const beforeB = await get(storageKey('b'));
        const ciphertextA = await get(storageKey('a'));
        expect(ciphertextA).toMatch(/^tlb-sealed:v1:/);
        expect(beforeB).toMatch(/^tlb-sealed:v1:/);

        expect(await ensureBoundedPendingSequences('a', 's01')).toEqual(beforeA);
        expect(await get(storageKey('a'))).toEqual(ciphertextA);
        expect(await readLocal('a')).toEqual(beforeA);
        expect(await get(storageKey('b'))).toEqual(beforeB);
    });

    it('preserves a corrupt record and fails closed instead of treating it as absent', async () => {
        const valid = await installOversizedJournal('a');
        const corrupt = {
            ...valid,
            pending: [{ ...valid.pending[0], actorId: 'another-actor' }],
        };
        await updateArchiveRecord<LocalEnvelope>('user:a', () => corrupt);
        const encrypted = await get(storageKey('a'));
        expect(encrypted).toMatch(/^tlb-sealed:v1:/);

        await expect(ensureBoundedPendingSequences('a', 's00')).rejects.toThrow('Invalid causal dot');
        expect(await get(storageKey('a'))).toEqual(encrypted);
    });

    it('does not create a missing archive', async () => {
        await createAndMigrateVault('user:missing');
        expect(await ensureBoundedPendingSequences('missing', 's00')).toBeUndefined();
        expect(await get(storageKey('missing'))).toBeUndefined();
    });

    it('rejects a session already stale after the read without rewriting ciphertext', async () => {
        const before = await installOversizedJournal('a');
        const encrypted = await get(storageKey('a'));
        await expect(ensureBoundedPendingSequences('a', 's00', () => false))
            .rejects.toThrow('Sequenze journal invalidate dal cambio sessione');
        expect(await get(storageKey('a'))).toBe(encrypted);
        expect(await readLocal('a')).toEqual(before);
    });

    it('resequences the latest durable journal and preserves an edit appended after the observed read', async () => {
        await installOversizedJournal('a');
        const concurrent = changeAfterObservedRead(current => ({
            ...current,
            pending: [...current.pending, operation('nutrition_months/2026-02', 7)],
            actorSeq: 7,
            clock: { ...current.clock, s00: 7 },
            data: { ...current.data, profile: { ...current.data.profile, height: '178' } },
            revision: current.revision + 1,
        }));

        const after = await ensureBoundedPendingSequences('a', 's00');
        expect(after?.pending).toHaveLength(MAX_SYNC_DOCUMENTS_PER_TRANSACTION + 3);
        expect(after?.pending.at(-1)).toMatchObject({
            docPath: 'nutrition_months/2026-02', seq: 8, clock: { s00: 8 },
        });
        expect(after?.pending.filter(op => op.seq === 7)).toEqual([
            expect.objectContaining({ docPath: 'nutrition_months/2026-01' }),
        ]);
        expect(after?.actorSeq).toBe(8);
        expect(after?.clock).toEqual({ s00: 8, s01: 3 });
        expect(after?.revision).toBe(concurrent.envelope!.revision + 1);
        expect(after?.data).toEqual(concurrent.envelope!.data);
        expect(after?.baseline).toEqual(concurrent.envelope!.baseline);
        expect(after?.syncMetaByDocument).toEqual(concurrent.envelope!.syncMetaByDocument);
        expect(await readLocal('a')).toEqual(after);
    });

    it('does not overwrite a different actor installed between the read and atomic update', async () => {
        await installOversizedJournal('a');
        const concurrent = changeAfterObservedRead(current => ({
            ...current,
            actorId: 's01', actorSeq: 3,
            pending: [operation('nutrition_months/2026-02', 3, 's01')],
            revision: current.revision + 1,
        }));

        expect(await ensureBoundedPendingSequences('a', 's00')).toEqual(concurrent.envelope);
        expect(await get(storageKey('a'))).toBe(concurrent.ciphertext);
        expect(await readLocal('a')).toEqual(concurrent.envelope);
    });

    it('preserves a journal already drained by another tab without resealing or advancing its revision', async () => {
        await installOversizedJournal('a');
        const concurrent = changeAfterObservedRead(current => ({
            ...current, pending: [], revision: current.revision + 1,
        }));

        expect(await ensureBoundedPendingSequences('a', 's00')).toEqual(concurrent.envelope);
        expect(await get(storageKey('a'))).toBe(concurrent.ciphertext);
        expect(await readLocal('a')).toEqual(concurrent.envelope);
    });

    it('rejects a newly corrupt encrypted journal inside the atomic update and preserves its bytes', async () => {
        await installOversizedJournal('a');
        const concurrent = changeAfterObservedRead(current => ({
            ...current,
            pending: [{ ...current.pending[0], actorId: 'another-actor' }],
            revision: current.revision + 1,
        }));

        await expect(ensureBoundedPendingSequences('a', 's00')).rejects.toThrow('Invalid causal dot');
        expect(await get(storageKey('a'))).toBe(concurrent.ciphertext);
    });

});
