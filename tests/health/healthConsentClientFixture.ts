import { vi } from 'vitest';
import { LEGAL_VERSIONS } from '../../src/lib/legalVersions';

export const user = (uid: string) => ({ uid, getIdToken: vi.fn(async () => 'id-token') }) as any;
export const key = (uid: string) => `logbook:v2:user:${uid}:health-consent-withdrawal`;
export const accepted = { acceptedTerms: true as const, acceptedHealthData: true as const, privacyVersion: LEGAL_VERSIONS.privacy, termsVersion: LEGAL_VERSIONS.terms };
// A trusted GET has complete acceptance evidence. Keep the fixture realistic
// rather than silently teaching the client that active/revision alone is proof.
export const trustedConsentResponse = (payload: Record<string, unknown>, init?: ResponseInit): Response => {
  if (payload.status !== 'active' || typeof payload.revision !== 'number' || payload.revision < 1) {
    return Response.json(payload, init);
  }
  return Response.json({
    acceptedAt: '2026-10-13T10:00:00.000Z',
    privacyVersion: accepted.privacyVersion,
    termsVersion: accepted.termsVersion,
    ...payload,
  }, init);
};
