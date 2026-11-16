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
