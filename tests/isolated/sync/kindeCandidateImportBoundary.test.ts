import { describe, expect, it, vi } from 'vitest';

vi.mock('../../../src/lib/firebase', () => {
    throw Error('Kinde D1 candidate must not initialize Firebase');
});

import { prepareKindeCandidateOwner } from '../../../src/lib/sync/kindeCandidateOwnerBootstrap';
import { claimKindeCandidateReplica } from '../../../src/lib/sync/kindeCandidateReplicaClaimBridge';
import { deliverKindeCandidateJournal } from '../../../src/lib/sync/kindeCandidateJournalBridge';
import { stageCloudflareReplicaClaim, resumeCloudflareReplicaClaim } from '../../../src/lib/sync/cloudReplicaClaimRecovery';
import { openKindeCandidateFitnessRealm } from '../../../src/lib/auth/kindeCandidateFitnessRealm';
import { useKindeCandidateFitnessLifecycle } from '../../../src/contexts/auth/useKindeCandidateFitnessLifecycle';
import { restoreKindeCandidateBackup } from '../../../src/lib/auth/kindeCandidateRestore';
import { withdrawKindeCandidateHealthConsent } from '../../../src/lib/auth/kindeCandidateWithdrawal';

describe('Kinde D1 account modules do not import legacy Firebase', () => {
    it('loads the complete owner, replica and journal entrypoints without Firebase', () => {
        expect(typeof prepareKindeCandidateOwner).toBe('function');
        expect(typeof claimKindeCandidateReplica).toBe('function');
        expect(typeof deliverKindeCandidateJournal).toBe('function');
        expect(typeof stageCloudflareReplicaClaim).toBe('function');
        expect(typeof resumeCloudflareReplicaClaim).toBe('function');
        expect(typeof openKindeCandidateFitnessRealm).toBe('function');
        expect(typeof useKindeCandidateFitnessLifecycle).toBe('function');
        expect(typeof restoreKindeCandidateBackup).toBe('function');
        expect(typeof withdrawKindeCandidateHealthConsent).toBe('function');
    });
});
