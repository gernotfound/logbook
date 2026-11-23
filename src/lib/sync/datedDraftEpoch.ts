import {
    readFencedDatedDraftImage as read,
    writeFencedDatedDraft as write,
} from './datedDraftRecord';
import { ordinaryDatedDraftStorage } from './datedDraftStorage';

export { DatedDraftConflictError, UnverifiedDatedDraftEpochError, type DatedDraftImage } from './datedDraftRecord';

export function readFencedDatedDraftImage(name: string, owner: string) {
    return read(name, owner, ordinaryDatedDraftStorage(owner));
}

/** Copies from revoked generations are evidence, not current editing state. */
export function readFencedDatedDraft(name: string, owner: string) {
    return readFencedDatedDraftImage(name, owner).values;
}

export function writeFencedDatedDraft(
    name: string, owner: string, values: Record<string, string> | null, expectedRaw?: string | null,
) {
    return write(name, owner, values, expectedRaw, ordinaryDatedDraftStorage(owner));
}
