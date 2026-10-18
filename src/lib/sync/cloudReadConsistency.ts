import equal from 'fast-deep-equal';

/**
 * Firestore getDocFromServer supplies one control-document version. The client
 * writer advances sync_control within every business transaction; matching
 * reads before/after a multi-document scan are the witness that no supported
 * business mutation crossed the scan. No cache evidence is accepted here.
 *
 * This is not a transactional snapshot of arbitrary admin writes or catalog
 * refreshes: those must obey their own lifecycle boundary.
 */
type CloudControlObservation = { exists(): boolean; data(): unknown };

export function sameCloudControlState(before: CloudControlObservation, after: CloudControlObservation): boolean {
    if (before.exists() !== after.exists()) return false;
    return !before.exists() || equal(before.data(), after.data());
}
