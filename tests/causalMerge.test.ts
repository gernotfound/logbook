import { describe, it, expect } from 'vitest';
import { applySemanticOperations, type SemanticOperation, type SyncMeta } from '../src/lib/sync/semanticProjection';
import type { DocumentData } from '../src/lib/sync/documentProjection';

describe('Causal Semantic Merge', () => {
    it('Causal Dominance: A sync → B osserva → B modifica (B vince sempre)', () => {
        const base = new Map<string, DocumentData>();
        base.set('', {
            profile: { height: '180' }
        });
        
        const remoteSyncMetas: Record<string, SyncMeta> = {
            '': {
                clock: { A: 1 },
                fields: {
                    'profile': {
                        clock: { A: 1 },
                        actorId: 'A',
                        seq: 1
                    }
                }
            }
        };

        const ops: SemanticOperation[] = [
            {
                docPath: '',
                property: 'profile',
                value: { height: '182' },
                isDelete: false,
                actorId: 'B',
                seq: 1,
                // B osserva il clock di A
                clock: { A: 1, B: 1 }
            }
        ];

        const { documents, syncMetas } = applySemanticOperations(base, ops, remoteSyncMetas);
        expect(documents.get('')?.profile).toEqual({ height: '182' });
        expect(syncMetas[''].fields['profile'].actorId).toBe('B');
    });

    it('Tie-Break Concorrente: Stessa proprietà modificata offline, vince actorId maggiore o seq maggiore', () => {
        const base = new Map<string, DocumentData>();
        
        const remoteSyncMetas: Record<string, SyncMeta> = {
            '': {
                clock: { A: 1 },
                fields: {
                    'profile': {
                        clock: { A: 1 },
                        actorId: 'A',
                        seq: 1
                    }
                }
            }
        };

        // B concurrent with A
        const ops: SemanticOperation[] = [
            {
                docPath: '',
                property: 'profile',
                value: { height: '182' },
                isDelete: false,
                actorId: 'B',
                seq: 1,
                // B does not observe A
                clock: { B: 1 }
            }
        ];

        // Since B > A, B should win
        const { documents, syncMetas } = applySemanticOperations(base, ops, remoteSyncMetas);
        expect(documents.get('')?.profile).toEqual({ height: '182' });
        expect(syncMetas[''].fields['profile'].actorId).toBe('B');
    });

    it('Merge Granulare: Due device offline modificano campi diversi dello stesso shard (es. due giorni diversi in nutrition), entrambi vengono mantenuti', () => {
        const base = new Map<string, DocumentData>();
        base.set('nutrition_months/2023-10', {
            '2023-10-01': { kcal: 2000 }
        });
        
        const remoteSyncMetas: Record<string, SyncMeta> = {
            'nutrition_months/2023-10': {
                clock: { A: 1 },
                fields: {
                    '2023-10-01': {
                        clock: { A: 1 },
                        actorId: 'A',
                        seq: 1
                    }
                }
            }
        };

        const ops: SemanticOperation[] = [
            {
                docPath: 'nutrition_months/2023-10',
                property: '2023-10-02',
                value: { kcal: 2500 },
                isDelete: false,
                actorId: 'B',
                seq: 1,
                clock: { B: 1 }
            }
        ];

        const { documents, syncMetas } = applySemanticOperations(base, ops, remoteSyncMetas);
        
        // Granular merge maintains both
        const doc = documents.get('nutrition_months/2023-10');
        expect(doc?.['2023-10-01']).toEqual({ kcal: 2000 });
        expect(doc?.['2023-10-02']).toEqual({ kcal: 2500 });
        
        expect(syncMetas['nutrition_months/2023-10'].fields['2023-10-01'].actorId).toBe('A');
        expect(syncMetas['nutrition_months/2023-10'].fields['2023-10-02'].actorId).toBe('B');
    });

    it('Tombstone Resurrection: Una delete concorrente vs update deve rispettare la regola delete wins, e il tombstone deve impedire la resurrezione', () => {
        const base = new Map<string, DocumentData>();
        
        // Remote has deleted it concurrently
        const remoteSyncMetas: Record<string, SyncMeta> = {
            '': {
                clock: { A: 1 },
                fields: {
                    'profile': {
                        clock: { A: 1 },
                        actorId: 'A',
                        seq: 1,
                        deleted: true
                    }
                }
            }
        };

        // B tries to update it concurrently
        const ops: SemanticOperation[] = [
            {
                docPath: '',
                property: 'profile',
                value: { height: '182' },
                isDelete: false,
                actorId: 'B',
                seq: 1,
                clock: { B: 1 }
            }
        ];

        const { documents, syncMetas } = applySemanticOperations(base, ops, remoteSyncMetas);
        
        // Delete wins
        expect(documents.get('')?.profile).toBeUndefined();
        expect(syncMetas[''].fields['profile'].deleted).toBe(true);
    });
});
