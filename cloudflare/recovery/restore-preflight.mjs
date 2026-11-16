// CF-08 operator-only preflight primitive. Caller must obtain the authoritative
// floor from an independently retained, authenticated resource outside the
// database being restored. A copy from that same D1 is not independent proof.
const STATUSES = new Set(['active', 'withdrawn', 'deleting', 'deleted']);

function valid(row) {
  return row && typeof row === 'object' && !Array.isArray(row)
    && typeof row.uid === 'string' && row.uid.length > 0
    && row.uid.length <= 128 && !row.uid.includes('/')
    && Number.isSafeInteger(row.consentRevision) && row.consentRevision >= 1
    && Number.isSafeInteger(row.fenceEpoch) && row.fenceEpoch >= 1
    && Number.isSafeInteger(row.erasedBeforeRevision)
    && row.erasedBeforeRevision >= 0
    && row.erasedBeforeRevision <= row.consentRevision
    && STATUSES.has(row.status);
}

/**
 * Compare one restored D1 subject with an independently attested monotone
 * floor. This is a diagnostic, NOT a runtime authorization or permission to
 * restore. Missing external coverage fails closed. A consistent result cannot
 * establish that every owner was scanned or that the evidence is authentic.
 */
export function inspectRestoredOwnerFence(restored, independentFloor) {
  const blocked = reason => ({ outcome: 'blocked', reason });
  if (!valid(independentFloor)) return blocked('independent-proof-missing-or-invalid');
  if (!valid(restored)) return blocked('restored-owner-missing-or-invalid');
  if (restored.uid !== independentFloor.uid) return blocked('owner-mismatch');
  if (restored.consentRevision < independentFloor.consentRevision
    || restored.fenceEpoch < independentFloor.fenceEpoch
    || restored.erasedBeforeRevision < independentFloor.erasedBeforeRevision) {
    return blocked('restored-generation-older-than-independent-floor');
  }
  if (independentFloor.status === 'deleted' && restored.status !== 'deleted') {
    return blocked('deleted-owner-resurrected');
  }
  if (independentFloor.status !== 'active' && restored.status === 'active') {
    return blocked('withdrawn-owner-resurrected');
  }
  return { outcome: 'consistent-for-diagnostics-only' };
}

/**
 * Check whether a supplied multi-owner diagnostic scan matches an independently
 * supplied list of floors, with no owner silently omitted, repeated or added.
 * The caller MUST separately authenticate the source and establish that its
 * owner list is complete; matching two incomplete lists proves nothing.
 * This is never an authorization to restore or reopen access.
 */
export function inspectRestoredOwnerCoverage(restoredOwners, independentFloors) {
  const blocked = reason => ({ outcome: 'blocked', reason });
  if (!Array.isArray(independentFloors) || independentFloors.length === 0
    || independentFloors.some(row => !valid(row))) {
    return blocked('independent-coverage-missing-or-invalid');
  }
  if (!Array.isArray(restoredOwners) || restoredOwners.some(row => !valid(row))) {
    return blocked('restored-coverage-missing-or-invalid');
  }
  const floors = new Map();
  for (const row of independentFloors) {
    if (floors.has(row.uid)) return blocked('independent-owner-duplicate');
    floors.set(row.uid, row);
  }
  const subjects = new Map();
  for (const row of restoredOwners) {
    if (subjects.has(row.uid)) return blocked('restored-owner-duplicate');
    subjects.set(row.uid, row);
  }
  if (subjects.size !== floors.size || [...floors.keys()].some(uid => !subjects.has(uid))) {
    return blocked('owner-coverage-mismatch');
  }
  for (const [uid, floor] of floors) {
    const result = inspectRestoredOwnerFence(subjects.get(uid), floor);
    if (result.outcome === 'blocked') return result;
  }
  return { outcome: 'consistent-for-diagnostics-only' };
}
