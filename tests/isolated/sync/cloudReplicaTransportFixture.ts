/** Shared representative batch for transport receipt verification. */
export const replicaTransportBatch = {
    batchId: 'batch000000000001', expectedRevision: 0, expectedFenceEpoch: 5,
    consentRevision: 1, replica: { slot: 's00', replicaId: 'replica-test', generation: 1 },
    lastSeq: 1, documents: [],
};
