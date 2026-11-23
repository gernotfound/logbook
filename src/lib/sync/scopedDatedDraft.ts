import { DatedDraftConflictError, readFencedDatedDraftImage, writeFencedDatedDraft } from './datedDraftRecord';
import type { DatedDraftStorage } from './datedDraftStorage';
import {
    clearDatedWriterIntent, createDatedWriterIntentName, isDatedWriterIntentName,
    readDatedWriterEvidence, writeDatedWriterIntent,
} from './datedDraftWriterRecords';
import { requiredUpdateRecoveryRegistry } from './requiredUpdateRecovery';
import { openScopedDeviceRecords } from './scopedDeviceRecord';
import { traceWriterLineage, writerParentReference } from './writerLineage';
import { draftRegistry } from '../utils/draftRegistry';

type Values = Record<string, string>;

/**
 * A candidate realm owns its archive capability. Use the normal dated record
 * and writer lineage without publishing the vault key to the ordinary UI.
 */
export async function openScopedDatedDraft({
    name, owner, revision, permitted,
}: { name: string; owner: string; revision: number; permitted: () => boolean }) {
    if (!owner.startsWith('user:') || !Number.isSafeInteger(revision) || revision < 1) {
        throw new Error('Consenso della bozza non verificabile.');
    }
    const records = await openScopedDeviceRecords(owner, name, permitted,
        record => record === name || isDatedWriterIntentName(record));
    const storage: DatedDraftStorage = {
        read: record => records.read(record).plaintext,
        write: (record, value, observed) => {
            const current = records.read(record);
            if (current.plaintext !== observed) throw new DatedDraftConflictError();
            records.replace(record, current.raw, value);
        },
        readRevision: () => {
            records.requireCurrent();
            return revision;
        },
    };
    try {
        let observed = readFencedDatedDraftImage(name, owner, storage);
        const lineage = () => traceWriterLineage(readDatedWriterEvidence(owner, name, storage));
        const source = lineage();
        if (JSON.stringify(source.at(-1)?.values ?? null) !== JSON.stringify(observed.values)) {
            throw new DatedDraftConflictError();
        }
        const writer = createDatedWriterIntentName();
        const generation = String(revision);
        let witness: string | null = null;
        const assertLineage = () => {
            const expected = witness === null ? source : [...source, { name: writer, raw: witness }];
            const current = lineage();
            if (current.length !== expected.length
                || current.some((item, index) => item.name !== expected[index].name || item.raw !== expected[index].raw)) {
                throw new DatedDraftConflictError();
            }
            return current.at(-1);
        };
        const assertObserved = () => {
            if (readFencedDatedDraftImage(name, owner, storage).raw !== observed.raw) {
                throw new DatedDraftConflictError();
            }
        };
        const verify = () => {
            assertObserved();
            const latest = assertLineage();
            assertObserved();
            if (JSON.stringify(latest?.values ?? null) !== JSON.stringify(observed.values)) {
                throw new DatedDraftConflictError();
            }
        };
        // An ordinary retry or required reload must not rewrite a durable
        // draft. It does verify that the observed copy is still recoverable.
        verify();
        draftRegistry.register(verify);
        const unregisterRecovery = requiredUpdateRecoveryRegistry.register(verify);
        const close = () => {
            draftRegistry.unregister(verify);
            unregisterRecovery();
            records.close();
        };
        return {
            current: () => { verify(); return observed.values; },
            replace: (values: Values) => {
                verify();
                witness = writeDatedWriterIntent(writer, owner, name, values, witness, generation,
                    writerParentReference(source.at(-1)), storage);
                // Losing the shared write retains this editor's full input.
                assertLineage();
                observed = { values, raw: writeFencedDatedDraft(name, owner, values, observed.raw, storage) };
            },
            discard: () => {
                verify();
                writeFencedDatedDraft(name, owner, null, observed.raw, storage);
                if (witness !== null) clearDatedWriterIntent(writer, owner, witness, generation, storage);
                for (const item of [...source].reverse()) {
                    clearDatedWriterIntent(item.name, owner, item.raw, generation, storage);
                }
                close();
            },
            close,
        };
    } catch (error) {
        records.close();
        throw error;
    }
}
