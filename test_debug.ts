import { applySemanticOperations } from './src/lib/sync/semanticProjection';
const base = new Map();
const remoteSyncMetas = {
    '': {
        protocolVersion: 1,
        clock: { A: 1 },
        fields: { 'profile/height': { clock: { A: 1 }, actorId: 'A', seq: 1 } }
    }
};
const ops = [
    { docPath: '', path: ['profile', 'height'], value: '182', isDelete: false, actorId: 'B', seq: 1, clock: { B: 1 } }
];
const { documents } = applySemanticOperations(base, ops, remoteSyncMetas);
console.log("Documents:", documents);
console.log("Profile:", documents.get('')?.profile);
