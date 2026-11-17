import { readBrowserValueStrict, removeBrowserValue, writeBrowserValue } from './browserStorage';
import { normalizeStorageOwner } from './owner';

// Kept outside the owner-scoped cleanup prefix. "deleting" may require a
// retry; "retired" is fully cleaned and must NEVER trigger a second purge.
const DELETING = 'purge-in-progress:v1';
const RETIRED = 'purge-complete:v1';
const keyFor = (owner: string) => 'logbook:local-purge-fence:v1:' + normalizeStorageOwner(owner);

export class LocalPurgePendingError extends Error {
    readonly code = 'local-purge-pending';
    constructor() {
        super('Pulizia archivio locale non conclusa. Nessun dato viene riscritto durante il recupero.');
        this.name = 'LocalPurgePendingError';
    }
}

function readPhase(owner: string): string | null {
    const value = readBrowserValueStrict(keyFor(owner));
    if (value !== null && value !== DELETING && value !== RETIRED) throw new LocalPurgePendingError();
    return value;
}

export function isLocalPurgePending(owner: string): boolean {
    return readPhase(owner) !== null;
}

export function isLocalPurgeIncomplete(owner: string): boolean {
    return readPhase(owner) === DELETING;
}

export function assertNoLocalPurge(owner: string): void {
    if (isLocalPurgePending(owner)) throw new LocalPurgePendingError();
}

/** Persist the cross-tab write fence BEFORE deleting data or keys. */
export function beginLocalPurge(owner: string): void {
    if (readPhase(owner) === null) writeBrowserValue(keyFor(owner), DELETING);
    if (!isLocalPurgePending(owner)) throw new LocalPurgePendingError();
}

/** Never replay a successful purge over a later guest generation. */
export function markLocalPurgeComplete(owner: string): void {
    if (!isLocalPurgeIncomplete(owner)) throw new LocalPurgePendingError();
    writeBrowserValue(keyFor(owner), RETIRED);
    if (isLocalPurgeIncomplete(owner)) throw new LocalPurgePendingError();
}

/** The sign-out callback failed before any storage deletion began. */
export function cancelUnstartedLocalPurge(owner: string): void {
    if (!isLocalPurgeIncomplete(owner)) throw new LocalPurgePendingError();
    removeBrowserValue(keyFor(owner));
    assertNoLocalPurge(owner);
}

/** Only after a replacement migrating vault control is durable. */
export function releaseLocalPurgeFence(owner: string): void {
    if (readPhase(owner) !== RETIRED) throw new LocalPurgePendingError();
    removeBrowserValue(keyFor(owner));
    assertNoLocalPurge(owner);
}
