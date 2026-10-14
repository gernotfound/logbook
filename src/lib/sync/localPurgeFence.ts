import { readBrowserValueStrict, removeBrowserValue, writeBrowserValue } from './browserStorage';
import { normalizeStorageOwner } from './owner';

// Outside owner-scoped cleanup: a retired owner stays fenced until a new
// vault control has been durably installed, even after a tab is killed.
const FENCE_VALUE = 'purge-in-progress:v1';
const keyFor = (owner: string) => 'logbook:local-purge-fence:v1:' + normalizeStorageOwner(owner);

export class LocalPurgePendingError extends Error {
    readonly code = 'local-purge-pending';
    constructor() {
        super('Pulizia archivio locale non conclusa. Nessun dato viene riscritto durante il recupero.');
        this.name = 'LocalPurgePendingError';
    }
}

export function isLocalPurgePending(owner: string): boolean {
    const value = readBrowserValueStrict(keyFor(owner));
    if (value === null) return false;
    if (value !== FENCE_VALUE) throw new LocalPurgePendingError();
    return true;
}

export function assertNoLocalPurge(owner: string): void {
    if (isLocalPurgePending(owner)) throw new LocalPurgePendingError();
}

/** Publish the cross-tab write fence BEFORE deleting data or any key. */
export function beginLocalPurge(owner: string): void {
    if (!isLocalPurgePending(owner)) writeBrowserValue(keyFor(owner), FENCE_VALUE);
    if (!isLocalPurgePending(owner)) throw new LocalPurgePendingError();
}

/** Only after a new empty vault control has been durably published. */
export function releaseLocalPurgeFence(owner: string): void {
    if (!isLocalPurgePending(owner)) return;
    removeBrowserValue(keyFor(owner));
    assertNoLocalPurge(owner);
}
