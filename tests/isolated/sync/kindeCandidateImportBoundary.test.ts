import { describe, expect, it, vi } from 'vitest';

vi.mock('../../../src/lib/firebase', () => {
    throw Error('Kinde D1 candidate must not initialize Firebase');
});

import { prepareKindeCandidateOwner } from '../../../src/lib/sync/kindeCandidateOwnerBootstrap';
import { claimKindeCandidateReplica } from '../../../src/lib/sync/kindeCandidateReplicaClaimBridge';
import { deliverKindeCandidateJournal } from '../../../src/lib/sync/kindeCandidateJournalBridge';
import { stageCloudflareReplicaClaim, resumeCloudflareReplicaClaim } from '../../../src/lib/sync/cloudReplicaClaimRecovery';

describe('Kinde D1 account modules do not import legacy Firebase', () => {
    it('loads the complete owner, replica and journal entrypoints without Firebase', () => {
        expect(typeof prepareKindeCandidateOwner).toBe('function');
        expect(typeof claimKindeCandidateReplica).toBe('function');
        expect(typeof deliverKindeCandidateJournal).toBe('function');
        expect(typeof stageCloudflareReplicaClaim).toBe('function');
        expect(typeof resumeCloudflareReplicaClaim).toBe('function');
    });
});
