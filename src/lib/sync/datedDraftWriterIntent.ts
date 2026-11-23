import {
    clearDatedWriterIntent as clear,
    inspectDatedRecoveryEvidence as inspect,
    readDatedWriterEvidence as read,
    writeDatedWriterIntent as write,
} from './datedDraftWriterRecords';
import { ordinaryDatedDraftStorage } from './datedDraftStorage';
import type { WriterLineageReference } from './writerLineage';

export {
    createDatedWriterIntentName, DatedWriterConsumedError, type DatedWriterEvidence,
} from './datedDraftWriterRecords';

export function readDatedWriterEvidence(owner: string, draftName: string) {
    return read(owner, draftName, ordinaryDatedDraftStorage(owner));
}

export function writeDatedWriterIntent(
    name: string, owner: string, draftName: string, values: Record<string, string>,
    expectedRaw: string | null, expectedConsentGeneration?: string | null, parent?: WriterLineageReference,
) {
    return write(name, owner, draftName, values, expectedRaw, expectedConsentGeneration,
        parent, ordinaryDatedDraftStorage(owner));
}

export function clearDatedWriterIntent(
    name: string, owner: string, expectedRaw: string, expectedConsentGeneration?: string | null,
) {
    return clear(name, owner, expectedRaw, expectedConsentGeneration, ordinaryDatedDraftStorage(owner));
}

export function inspectDatedRecoveryEvidence(owner: string) {
    return inspect(owner, ordinaryDatedDraftStorage(owner));
}
