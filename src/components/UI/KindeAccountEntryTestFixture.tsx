import { afterEach, beforeEach, vi } from 'vitest';
import { cleanup } from '@testing-library/react';
import { readKindeCandidateIdentity } from '../../lib/auth/kindeCandidateIdentity';
import {
    readKindeCandidateAccess, revokeKindeCandidateSession,
} from '../../lib/auth/kindeCandidateClient';
import { acceptKindeCandidateInitialConsent } from '../../lib/auth/kindeCandidateConsent';
import { prepareKindeCandidateOwner } from '../../lib/sync/kindeCandidateOwnerBootstrap';
import { unlockVaultForOwner } from '../../lib/sync/secureArchiveSession';
import { isKindeAccountLocalFitnessClear } from '../../lib/sync/kindeOwnerLocalFitnessFence';
import { prepareKindeCandidatePortableBackupJson } from '../../lib/auth/kindeCandidatePortableBackup';
import {
    withdrawKindeCandidateHealthConsent, reconcileKindeCandidateWithdrawal,
} from '../../lib/auth/kindeCandidateWithdrawal';
import { prepareKindeCandidateRightsJson } from '../../lib/auth/kindeCandidateRightsExport';
import { createBackup } from '../../lib/backup';
import { UserDataSchema } from '../../lib/schema';

vi.mock('../../hooks/usePWAInstall', () => ({
    usePWAInstall: vi.fn(() => ({
        isInstallable: false, isIOSInstallable: false, isStandalone: false,
        promptInstall: vi.fn(async () => {}),
    })),
}));

vi.mock('../../lib/auth/kindeCandidateIdentity', () => ({
    readKindeCandidateIdentity: vi.fn(),
}));
vi.mock(import('../../lib/auth/kindeCandidateClient'), async importOriginal => ({
    ...await importOriginal(),
    readKindeCandidateAccess: vi.fn(),
    revokeKindeCandidateSession: vi.fn(),
    submitKindeHostedSignIn: vi.fn(),
}));
vi.mock('../../lib/auth/kindeCandidateConsent', () => ({
    acceptKindeCandidateInitialConsent: vi.fn(),
}));
vi.mock('../../lib/sync/kindeCandidateOwnerBootstrap', () => ({
    prepareKindeCandidateOwner: vi.fn(),
}));
vi.mock('../../lib/sync/secureArchiveSession', () => ({
    unlockVaultForOwner: vi.fn(),
}));
vi.mock('../../lib/sync/kindeOwnerLocalFitnessFence', () => ({
    isKindeAccountLocalFitnessClear: vi.fn(),
}));
vi.mock('../../lib/auth/kindeCandidatePortableBackup', () => ({
    prepareKindeCandidatePortableBackupJson: vi.fn(),
}));
vi.mock(import('../../lib/auth/kindeCandidateWithdrawal'), async importOriginal => ({
    ...await importOriginal(),
    withdrawKindeCandidateHealthConsent: vi.fn(),
    reconcileKindeCandidateWithdrawal: vi.fn(),
}));
vi.mock('../../lib/auth/kindeCandidateRightsExport', () => ({
    prepareKindeCandidateRightsJson: vi.fn(),
}));
vi.mock('../../pages/PrivacyPolicy', () => ({
    PrivacyPolicy: () => <p>Informativa privacy di prova</p>,
}));
vi.mock('../../pages/TermsAndConditions', () => ({
    TermsAndConditions: () => <p>Termini di prova</p>,
}));

export const A = 'k_' + 'A'.repeat(43);
export const B = 'k_' + 'B'.repeat(43);
const FIRST_CSRF = 'A'.repeat(43);
export const REPLACEMENT_CSRF = 'B'.repeat(42) + 'A';
export const browserWitness = { csrf: '' };
export const principal = { uid: A, fenceEpoch: 1, healthConsentRevision: 0, emailVerified: true };
export const verified = { kind: 'email-verified' as const, principal };
export const required = { kind: 'consent-required' as const, principal };
export const confirmed = {
    kind: 'consent-confirmed' as const,
    principal: { uid: A, fenceEpoch: 1, healthConsentRevision: 1 },
    legalConsent: {
        hasAcceptedTerms: true, hasAcceptedHealthData: true,
        acceptedAt: '2026-11-15T10:00:00.000Z',
        privacyVersion: '1.3.9', termsVersion: '1.2.5',
    },
};

beforeEach(() => {
    localStorage.clear();
    browserWitness.csrf = FIRST_CSRF;
    vi.spyOn(document, 'cookie', 'get').mockImplementation(() => '__Host-logbook_csrf=' + browserWitness.csrf);
    vi.mocked(readKindeCandidateIdentity).mockResolvedValue({ kind: 'signed-out' });
    vi.mocked(readKindeCandidateAccess).mockResolvedValue(required);
    vi.mocked(acceptKindeCandidateInitialConsent).mockResolvedValue(confirmed);
    vi.mocked(revokeKindeCandidateSession).mockResolvedValue();
    vi.mocked(prepareKindeCandidateOwner).mockResolvedValue({
        kind: 'candidate-observed', checkpointRevision: 1, replicaOutcome: 'already-active',
        journalOutcome: 'idle', journalDrained: true,
    });
    vi.mocked(isKindeAccountLocalFitnessClear).mockReturnValue(true);
    vi.mocked(unlockVaultForOwner).mockResolvedValue({
        isCurrent: () => true, release: vi.fn(),
    });
    const backup = createBackup(UserDataSchema.parse({ profile: { height: '182' } }),
        'user:' + A, { scope: 'cloud-and-device', months: [] });
    vi.mocked(prepareKindeCandidatePortableBackupJson).mockResolvedValue({
        filename: 'thelogbook_backup_prima_revoca_2026-11-19.json',
        json: JSON.stringify(backup), backup,
    });
    vi.mocked(withdrawKindeCandidateHealthConsent).mockResolvedValue({
        kind: 'withdrawal-recorded', deletionStatus: 'pending',
    });
    vi.mocked(reconcileKindeCandidateWithdrawal).mockResolvedValue({ kind: 'still-unconfirmed' });
    vi.mocked(prepareKindeCandidateRightsJson).mockResolvedValue({
        filename: 'thelogbook_diritti_cloud_2026-11-19.json',
        json: '{"format":"thelogbook-cloud-rights-export"}',
        documentCount: 0, cloudRevision: 1,
    });
    const OriginalURL = URL;
    const objectURL = vi.fn(() => 'blob:kinde-candidate-export');
    const revokeURL = vi.fn();
    vi.stubGlobal('URL', class extends OriginalURL {
        static createObjectURL = objectURL;
        static revokeObjectURL = revokeURL;
    });
});
afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
    vi.resetAllMocks();
});

