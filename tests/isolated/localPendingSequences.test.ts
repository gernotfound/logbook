import 'fake-indexeddb/auto';
import { clear, get, set } from 'idb-keyval';
import { beforeEach, describe, expect, it } from 'vitest';
import { UserDataSchema } from '../../src/lib/schema';
import type { UserData } from '../../src/types';
import {
    ensureBoundedPendingSequences,
    initializeLocal,
    readLocal,
} from '../../src/lib/sync/localRepository';
import type { LocalEnvelope } from '../../src/lib/sync/localEnvelopeValidation';
import type { SemanticOperation } from '../../src/lib/sync/semanticProjection';
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
    await set(storageKey(owner), stored);
    return stored;
}

beforeEach(() => clear());

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

    it('is idempotent once bounded, preserving the durable envelope and revision', async () => {
        await installOversizedJournal('a');
        const first = await ensureBoundedPendingSequences('a', 's00');
        const persisted = await get(storageKey('a'));

        expect(await ensureBoundedPendingSequences('a', 's00')).toEqual(first);
        expect(await get(storageKey('a'))).toEqual(persisted);
    });

    it('does not mutate a journal from another actor or owner', async () => {
        const beforeA = await installOversizedJournal('a');
        await initializeLocal('b', data);
        const beforeB = await get(storageKey('b'));

        expect(await ensureBoundedPendingSequences('a', 's01')).toEqual(beforeA);
        expect(await get(storageKey('a'))).toEqual(beforeA);
        expect(await get(storageKey('b'))).toEqual(beforeB);
    });

    it('preserves a corrupt record and fails closed instead of treating it as absent', async () => {
        const valid = await installOversizedJournal('a');
        const corrupt = {
            ...valid,
            pending: [{ ...valid.pending[0], actorId: 'another-actor' }],
        };
        await set(storageKey('a'), corrupt);

        await expect(ensureBoundedPendingSequences('a', 's00')).rejects.toThrow('causale');
        expect(await get(storageKey('a'))).toEqual(corrupt);
    });

    it('does not create a missing archive', async () => {
        expect(await ensureBoundedPendingSequences('missing', 's00')).toBeUndefined();
        expect(await get(storageKey('missing'))).toBeUndefined();
    });
});
