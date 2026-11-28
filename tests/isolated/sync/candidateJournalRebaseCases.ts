import { get } from 'idb-keyval';
import { describe, expect, it } from 'vitest';
import { UserDataSchema } from '../../../src/lib/schema';
import type { UserData } from '../../../src/types';
import { projectDocuments } from '../../../src/lib/sync/documentProjection';
import { fieldKey } from '../../../src/lib/sync/semanticProjection/metadata';
import { applySemanticOperations, diffDocuments } from '../../../src/lib/sync/semanticProjection';
import type { CandidateJournalTestContext } from './cloudflareJournalCandidate.test';

export function registerCandidateJournalRebaseCases({
    owner, storeKey, adk, profile, savedDelivery, changedRemote, transport,
    readLocal, deliverCloudflareJournalCandidate, CloudReplicaTransportError,
    readAccountCloudDocument, parseSyncMeta, sealCloudDocument, commitLocal,
    seed, updateArchiveRecord, stageCloudflareDelivery, initializeLocal, adoptReplicaCheckpoint,
}: CandidateJournalTestContext): void {
    describe('verified 409 rebase, AEAD and competing-device recovery', () => {
    const month = 'history_months/2026-11';
    const workout = (id: string, note: string) => ({ id, date: '2026-11-07', sessionNote: note,
        exercises: [{ id: `${id}-row`, exId: 'bench', sets: [{ id: `${id}-set`, kg: '40', reps: '8' }] }],
    });
    const history = (sessions: ReturnType<typeof workout>[]): UserData =>
        UserDataSchema.parse({ history: sessions }) as unknown as UserData;
    const nutritionMonth = 'nutrition_months/2026-11';
    const monthlyCatalog = { exercises: [], foods: [], manifest: {
        version: 'fixture', updatedAt: '2026-11-14T00:00:00.000Z', schemaVersion: 1,
        docRefs: { exercises: 'fixture/e', foods: 'fixture/f' },
        itemCounts: { exercises: 0, foods: 0 },
    }, cachedAt: 0 };
    const nutritionDay = (date: string, weight: number, kcal = 0) => ({ date, weight, kcal });
    const nutrition = (days: ReturnType<typeof nutritionDay>[]): UserData => UserDataSchema.parse({
        nutrition: Object.fromEntries(days.map(day => [day.date, day])),
    }) as unknown as UserData;

    async function stagedNutrition() {
        const first = nutritionDay('2026-11-07', 70);
        const second = nutritionDay('2026-11-08', 80);
        const base = nutrition([first, second]);
        const desired = nutrition([nutritionDay(first.date, 71), second]);
        await initializeLocal(owner, base);
        const now = Date.now();
        const replica = { slot: 's00', replicaId: 'cf04-candidate-device', generation: 1,
            checkpointAtMs: now, leaseUntilMs: now + 86_400_000 };
        const baseMeta = { protocolVersion: 3 as const, clock: {}, fields: {},
            writer: { slot: 's00', replicaId: replica.replicaId, generation: 1,
                seq: 0, consentRevision: 1 } };
        await adoptReplicaCheckpoint(owner, { identity: replica, baseSeq: 0 },
            { clock: {}, syncMetaByDocument: { [nutritionMonth]: baseMeta } });
        await commitLocal(owner, desired, base);
        const local = (await readLocal(owner))!;
        expect(local.pending.length).toBeGreaterThan(0);
        expect(local.pending.every(op => op.docPath === nutritionMonth
            && op.path[0] === first.date)).toBe(true);
        const control = { uid: owner.slice(5), revision: 1, fenceEpoch: 5, consentRevision: 1,
            replicas: { s00: { ...replica, lastSeq: 0, status: 'active' as const,
                checkpointClock: {} } } };
        const snapshot = { revision: 1, fenceEpoch: 5, consentRevision: 1,
            documents: [{ path: nutritionMonth, revision: 1,
                document: sealCloudDocument(adk, owner.slice(5), nutritionMonth,
                    projectDocuments(base, monthlyCatalog).get(nutritionMonth)!, baseMeta) }] };
        await stageCloudflareDelivery(owner, local.pending, snapshot, control,
            replica, 'batch000000009920', adk, () => true);
        return { local, control, snapshot, base, first, second };
    }

    function competingNutrition(setup: Awaited<ReturnType<typeof stagedNutrition>>, options: {
        date?: string; weight?: number; kcal?: number; missingStamp?: boolean; unexplainedClock?: boolean;
        newDay?: boolean; deletedDay?: boolean;
    } = {}) {
        const date = options.date ?? setup.second.date;
        const changed = nutrition([
            nutritionDay(setup.first.date, date === setup.first.date ? options.weight ?? 72 : 70),
            ...(options.deletedDay ? [] : [nutritionDay(setup.second.date,
                date === setup.second.date && !options.newDay ? options.weight ?? 81 : 80,
                date === setup.second.date ? options.kcal ?? 0 : 0)]),
            ...(options.newDay ? [nutritionDay('2026-11-09', 60)] : []),
        ]);
        const originalDocs = projectDocuments(setup.base, monthlyCatalog);
        const peerDocs = projectDocuments(changed, monthlyCatalog);
        const ops = diffDocuments(originalDocs, peerDocs, 's01', 1, { s01: 1 });
        const merged = applySemanticOperations(originalDocs, ops);
        const document = options.newDay ? peerDocs.get(nutritionMonth)! : merged.documents.get(nutritionMonth)!;
        // The remote value may contain a change to calculated totals, ignored
        // by the semantic diff, even when a legitimate weight stamp exists.
        if (options.kcal !== undefined) {
            (document[setup.second.date] as Record<string, unknown>).kcal = options.kcal;
        }
        const sync = { ...merged.syncMetas[nutritionMonth],
            clock: { s01: options.unexplainedClock ? 2 : 1 },
            fields: options.missingStamp ? {} : merged.syncMetas[nutritionMonth].fields,
            writer: { slot: 's01', replicaId: 'other-device', generation: 1,
                seq: 1, consentRevision: 1 } };
        const now = Date.now();
        return { control: { ...setup.control, revision: 2, replicas: {
            ...setup.control.replicas,
            s01: { slot: 's01', replicaId: 'other-device', generation: 1,
                status: 'active' as const, lastSeq: 1, checkpointClock: { s01: 1 },
                checkpointAtMs: now, leaseUntilMs: now + 86_400_000 },
        } }, scan: { revision: 2, fenceEpoch: 5, consentRevision: 1,
            documents: [{ path: nutritionMonth, revision: 2,
                document: sealCloudDocument(adk, owner.slice(5), nutritionMonth, document, sync) }] } };
    }

    async function stagedHistory() {
        const original = workout('baseline', 'existing');
        const offline = workout('offline', 'my local session');
        const base = history([original]);
        await initializeLocal(owner, base);
        const now = Date.now();
        const replica = { slot: 's00', replicaId: 'cf04-candidate-device', generation: 1,
            checkpointAtMs: now, leaseUntilMs: now + 86_400_000 };
        const baseMeta = { protocolVersion: 3 as const, clock: {}, fields: {},
            writer: { slot: 's00', replicaId: replica.replicaId, generation: 1, seq: 0,
                consentRevision: 1 } };
        await adoptReplicaCheckpoint(owner, { identity: replica, baseSeq: 0 },
            { clock: {}, syncMetaByDocument: { [month]: baseMeta } });
        await commitLocal(owner, history([original, offline]), base);
        const local = (await readLocal(owner))!;
        expect(local.pending.length).toBeGreaterThan(0);
        expect(local.pending.every(op => op.docPath === month && op.path[0] === 'offline')).toBe(true);
        const control = { uid: owner.slice(5), revision: 1, fenceEpoch: 5, consentRevision: 1,
            replicas: { s00: { ...replica, lastSeq: 0, status: 'active' as const,
                checkpointClock: {} } } };
        const snapshot = { revision: 1, fenceEpoch: 5, consentRevision: 1,
            documents: [{ path: month, revision: 1, document: sealCloudDocument(adk, owner.slice(5),
                month, { baseline: original }, baseMeta) }] };
        await stageCloudflareDelivery(owner, local.pending, snapshot, control,
            replica, 'batch000000009919', adk, () => true);
        return { local, control, snapshot, original, offline };
    }

    function competingHistory(setup: Awaited<ReturnType<typeof stagedHistory>>, options: {
        peerId?: string; stampPath?: string[] | null; unexplainedClock?: boolean;
        peerValue?: ReturnType<typeof workout>;
    } = {}) {
        const peerId = options.peerId ?? 'peer';
        const peer = options.peerValue ?? workout(peerId, 'other device session');
        const now = Date.now();
        const control = { ...setup.control, revision: 2, replicas: {
            ...setup.control.replicas,
            s01: { slot: 's01', replicaId: 'other-device-replica', generation: 1,
                status: 'active' as const, lastSeq: 1, checkpointClock: { s01: 1 },
                checkpointAtMs: now, leaseUntilMs: now + 86_400_000 },
        } };
        const baseDoc = { baseline: history([setup.original]).history![0] };
        const desiredDoc = { ...baseDoc, [peerId]: history([peer]).history![0] };
        const originalDocs = new Map([[month, baseDoc]]);
        const operations = diffDocuments(originalDocs, new Map([[month, desiredDoc]]),
            's01', 1, { s01: 1 });
        const computed = applySemanticOperations(originalDocs, operations);
        const business = computed.documents.get(month)!;
        const sync = computed.syncMetas[month];
        const fields = options.stampPath === undefined ? sync.fields
            : options.stampPath === null ? {}
                : { [fieldKey(options.stampPath)]: sync.fields[fieldKey(options.stampPath)] };
        const doc = sealCloudDocument(adk, owner.slice(5), month, business, {
            ...sync, clock: { s01: options.unexplainedClock ? 2 : 1 }, fields,
            writer: { slot: 's01', replicaId: 'other-device-replica', generation: 1,
                seq: 1, consentRevision: 1 },
        });
        return { control, scan: { revision: 2, fenceEpoch: 5, consentRevision: 1,
            documents: [{ path: month, revision: 2, document: doc }] } };
    }

    it('preserves independently updated nutrition days in one D1 monthly document', async () => {
        const setup = await stagedNutrition();
        const { control, scan } = competingNutrition(setup);
        const remote = transport(setup.control, setup.snapshot);
        remote.commit.mockRejectedValueOnce(new CloudReplicaTransportError(409));
        remote.commitOutcome.mockResolvedValueOnce({ outcome: 'not-committed', currentRevision: 2 });
        remote.control.mockResolvedValue(control);
        remote.scanAll.mockResolvedValue(scan);

        expect(await deliverCloudflareJournalCandidate(owner, adk, remote, 'csrf-session', () => true))
            .toBe('retry-staged');
        expect((await readLocal(owner))?.pending).toEqual(setup.local.pending);
        const replacement = (await readLocal(owner))!.cloudflareDelivery!.batch.documents[0];
        const opened = readAccountCloudDocument(replacement.document, 'independent nutrition rebase',
            owner.slice(5), nutritionMonth, adk);
        expect(opened.business[setup.first.date]).toMatchObject({ weight: 71 });
        expect(opened.business[setup.second.date]).toMatchObject({ weight: 81 });
        expect(remote.commit).toHaveBeenCalledOnce();
    });

    it.each([
        { label: 'same day', options: { date: '2026-11-07' } },
        { label: 'unwitnessed weight', options: { missingStamp: true } },
        { label: 'hidden computed total', options: { kcal: 120 } },
        { label: 'unaccounted document clock', options: { unexplainedClock: true } },
        { label: 'new nutrition day', options: { newDay: true } },
        { label: 'deleted nutrition day', options: { deletedDay: true } },
    ])('retains the exact encrypted nutrition journal for $label', async ({ options }) => {
        const setup = await stagedNutrition();
        const { control, scan } = competingNutrition(setup, options);
        const remote = transport(setup.control, setup.snapshot);
        remote.commit.mockRejectedValueOnce(new CloudReplicaTransportError(409));
        remote.commitOutcome.mockResolvedValueOnce({ outcome: 'not-committed', currentRevision: 2 });
        remote.control.mockResolvedValue(control);
        remote.scanAll.mockResolvedValue(scan);
        const stored = await get(storeKey);

        expect(await deliverCloudflareJournalCandidate(owner, adk, remote, 'csrf-session', () => true))
            .toBe('reconciliation-required');
        expect(await get(storeKey)).toBe(stored);
        expect((await readLocal(owner))?.pending).toEqual(setup.local.pending);
        expect(remote.commit).toHaveBeenCalledOnce();
    });

    it('conserves two different workouts edited offline in the same cloud month', async () => {
        const setup = await stagedHistory();
        const { control, scan } = competingHistory(setup);
        const remote = transport(setup.control, setup.snapshot);
        remote.commit.mockRejectedValueOnce(new CloudReplicaTransportError(409));
        remote.commitOutcome.mockResolvedValueOnce({ outcome: 'not-committed', currentRevision: 2 });
        remote.control.mockResolvedValue(control);
        remote.scanAll.mockResolvedValue(scan);

        expect(await deliverCloudflareJournalCandidate(owner, adk, remote, 'csrf-session', () => true))
            .toBe('retry-staged');
        expect((await readLocal(owner))!.pending).toEqual(setup.local.pending);
        const replacement = (await readLocal(owner))!.cloudflareDelivery!.batch.documents[0];
        const decrypted = readAccountCloudDocument(replacement.document, 'independent history rebase',
            owner.slice(5), month, adk);
        expect(Object.keys(decrypted.business).sort()).toEqual(['baseline', 'offline', 'peer']);
        expect(decrypted.business.offline).toMatchObject({ id: 'offline', sessionNote: 'my local session' });
        expect(decrypted.business.peer).toMatchObject({ id: 'peer', sessionNote: 'other device session' });
        expect(remote.commit).toHaveBeenCalledTimes(1);
        expect(remote.scanAll).toHaveBeenCalledOnce();
    });

    it.each([
        { label: 'same-workout update', peerId: 'offline', stampPath: ['offline', 'sessionNote'] },
        { label: 'unwitnessed peer update', stampPath: null },
        { label: 'one nested witness for several changed fields', stampPath: ['peer', 'sessionNote'] },
        { label: 'extra unaccounted causal frontier', unexplainedClock: true },
    ])('keeps the original ciphertext on $label', async ({ peerId, stampPath, unexplainedClock }) => {
        const setup = await stagedHistory();
        const { control, scan } = competingHistory(setup, { peerId, stampPath, unexplainedClock });
        const remote = transport(setup.control, setup.snapshot);
        remote.commit.mockRejectedValueOnce(new CloudReplicaTransportError(409));
        remote.commitOutcome.mockResolvedValueOnce({ outcome: 'not-committed', currentRevision: 2 });
        remote.control.mockResolvedValue(control);
        remote.scanAll.mockResolvedValue(scan);
        const originalCiphertext = await get(storeKey);

        expect(await deliverCloudflareJournalCandidate(owner, adk, remote, 'csrf-session', () => true))
            .toBe('reconciliation-required');
        expect(await get(storeKey)).toBe(originalCiphertext);
        expect((await readLocal(owner))!.pending).toEqual(setup.local.pending);
    });

    it('rejects a competing cross-month workout ID even if local and peer edits are disjoint', async () => {
        const setup = await stagedHistory();
        const { control, scan } = competingHistory(setup);
        const remote = transport(setup.control, setup.snapshot);
        remote.commit.mockRejectedValueOnce(new CloudReplicaTransportError(409));
        remote.commitOutcome.mockResolvedValueOnce({ outcome: 'not-committed', currentRevision: 2 });
        remote.control.mockResolvedValue(control);
        const conflictingSession = { ...history([setup.offline]).history![0], date: '2026-10-07' };
        remote.scanAll.mockResolvedValue({ ...scan, documents: [...scan.documents, {
            path: 'history_months/2026-10', revision: 2,
            document: sealCloudDocument(adk, owner.slice(5), 'history_months/2026-10',
                { offline: conflictingSession }, { protocolVersion: 3, clock: { s01: 1 }, fields: {
                    [fieldKey(['offline'])]: { actorId: 's01', seq: 1, clock: { s01: 1 } },
                }, writer: { slot: 's01', replicaId: 'other-device-replica', generation: 1,
                    seq: 1, consentRevision: 1 } }),
        }] });
        const before = await get(storeKey);

        expect(await deliverCloudflareJournalCandidate(owner, adk, remote, 'csrf-session', () => true))
            .toBe('reconciliation-required');
        expect(await get(storeKey)).toBe(before);
    });
    it('rebases a provably uncommitted 409 only after full AEAD scan and two stable controls', async () => {
        const setup = await savedDelivery();
        const before = (await readLocal(owner))!.cloudflareDelivery!.batch;
        const { control, scan } = changedRemote(setup);
        const remote = transport(setup.control, setup.snapshot);
        remote.commit.mockRejectedValueOnce(new CloudReplicaTransportError(409));
        remote.commitOutcome.mockResolvedValueOnce({ outcome: 'not-committed', currentRevision: 2 });
        remote.control.mockResolvedValue(control);
        remote.scanAll.mockResolvedValue(scan);

        await expect(deliverCloudflareJournalCandidate(owner, adk, remote, 'csrf-session', () => true))
            .resolves.toBe('retry-staged');
        expect(remote.commitOutcome).toHaveBeenCalledWith(before, 'csrf-session');
        expect(remote.control).toHaveBeenCalledTimes(2);
        expect(remote.scanAll).toHaveBeenCalledOnce();
        expect(remote.commit).toHaveBeenCalledOnce();
        const after = (await readLocal(owner))!;
        const replacement = after.cloudflareDelivery!.batch;
        expect(after.pending).toEqual(setup.local.pending);
        expect(replacement.batchId).not.toBe(before.batchId);
        expect(replacement.expectedRevision).toBe(2);
        expect(replacement.expectedFenceEpoch).toBe(5);
        expect(replacement.documents[0].document._sealed)
            .not.toEqual(before.documents[0].document._sealed);
        const opened = readAccountCloudDocument(replacement.documents[0].document,
            'CF04 candidate rebase regression', owner.slice(5), '', adk);
        expect(parseSyncMeta(opened.sync).clock.s00).toBe(1);

        // A second invocation replays the persisted replacement and does not
        // scan, reseal, or infer a prior successful acknowledgement.
        expect(await deliverCloudflareJournalCandidate(owner, adk, remote, 'csrf-session', () => true))
            .toBe('acknowledged');
        expect(remote.commit.mock.calls[1][0]).toEqual(replacement);
        expect(remote.scanAll).toHaveBeenCalledOnce();
        expect(remote.control).toHaveBeenCalledTimes(2);
        expect((await readLocal(owner))!.pending).toEqual([]);
    });

    it('rebases when the competing commit changed only a different document', async () => {
        const setup = await savedDelivery();
        const { control, scan } = changedRemote(setup);
        const remote = transport(setup.control, setup.snapshot);
        remote.commit.mockRejectedValueOnce(new CloudReplicaTransportError(409));
        remote.commitOutcome.mockResolvedValueOnce({ outcome: 'not-committed', currentRevision: 2 });
        remote.control.mockResolvedValue(control);
        remote.scanAll.mockResolvedValue({ ...scan, documents: [{
            path: 'nutrition_months/2026-11', revision: 2,
            document: sealCloudDocument(adk, owner.slice(5), 'nutrition_months/2026-11', {}, {
                protocolVersion: 3, clock: { s01: 1 }, fields: {},
                writer: { slot: 's01', replicaId: 'other-cloud-writer', generation: 1,
                    seq: 1, consentRevision: 1 },
            }),
        }] });

        expect(await deliverCloudflareJournalCandidate(owner, adk, remote, 'csrf-session', () => true))
            .toBe('retry-staged');
        expect((await readLocal(owner))!.pending).toEqual(setup.local.pending);
        expect((await readLocal(owner))!.cloudflareDelivery?.batch.expectedRevision).toBe(2);
    });

    it('does not confuse trusted local legal fields with a peer profile conflict before first cloud root', async () => {
        const setup = await seed();
        await updateArchiveRecord<unknown>(owner, raw => {
            const record = raw as { baseline: Record<string, unknown>; data: Record<string, unknown> };
            const trustedLegal = { hasAcceptedTerms: true, hasAcceptedHealthData: true,
                acceptedAt: '2026-11-20T00:00:00.000Z',
                privacyVersion: '1.3.9', termsVersion: '1.2.5' };
            return { ...record,
                baseline: { ...record.baseline, legalConsent: trustedLegal },
                data: { ...record.data, legalConsent: trustedLegal },
            };
        });
        await stageCloudflareDelivery(owner, setup.local.pending, setup.snapshot, setup.control,
            setup.replica, 'batch000000009912', adk, () => true);
        const { control, scan } = changedRemote(setup);
        const remote = transport(setup.control, setup.snapshot);
        remote.commit.mockRejectedValueOnce(new CloudReplicaTransportError(409));
        remote.commitOutcome.mockResolvedValueOnce({ outcome: 'not-committed', currentRevision: 2 });
        remote.control.mockResolvedValue(control);
        remote.scanAll.mockResolvedValue(scan);

        expect(await deliverCloudflareJournalCandidate(owner, adk, remote, 'csrf-session', () => true))
            .toBe('retry-staged');
        expect((await readLocal(owner))!.data.legalConsent?.hasAcceptedHealthData).toBe(true);
    });

    it.each([
        { height: 168, stampPath: 'profile/height' },
        { height: 170, stampPath: 'profile/height' },
        { height: 168, stampPath: 'profile/neck' },
        { height: 168, stampPath: null },
        { height: 170, stampPath: null },
    ])('preserves the original intent after a conflicting or unattributed root write (%o)', async ({ height, stampPath }) => {
        const setup = await savedDelivery();
        const original = (await readLocal(owner))!.cloudflareDelivery;
        const { control, scan } = changedRemote(setup);
        const competingRoot = sealCloudDocument(adk, owner.slice(5), '', {
            profile: { height: String(height), ...(stampPath === 'profile/neck' ? { neck: '37' } : {}) },
        }, {
            protocolVersion: 3, clock: { s01: 1 }, fields: stampPath ? {
                [stampPath]: { actorId: 's01', seq: 1, clock: { s01: 1 } },
            } : {},
            writer: { slot: 's01', replicaId: 'other-cloud-writer', generation: 1,
                seq: 1, consentRevision: 1 },
        });
        const remote = transport(setup.control, setup.snapshot);
        remote.commit.mockRejectedValueOnce(new CloudReplicaTransportError(409));
        remote.commitOutcome.mockResolvedValueOnce({ outcome: 'not-committed', currentRevision: 2 });
        remote.control.mockResolvedValue(control);
        remote.scanAll.mockResolvedValue({ ...scan, documents: [
            { path: '', revision: 2, document: competingRoot },
        ] });
        const before = await get(storeKey);

        expect(await deliverCloudflareJournalCandidate(owner, adk, remote, 'csrf-session', () => true))
            .toBe('reconciliation-required');
        expect(remote.control).toHaveBeenCalledTimes(2);
        expect(remote.scanAll).toHaveBeenCalledOnce();
        expect(remote.commit).toHaveBeenCalledOnce();
        expect(await get(storeKey)).toBe(before);
        expect((await readLocal(owner))!.cloudflareDelivery).toEqual(original);
        expect((await readLocal(owner))!.pending).toEqual(setup.local.pending);
    });

    it('keeps the sealed delivery if a non-commit proof is followed by a foreign control', async () => {
        const setup = await savedDelivery();
        const { control } = changedRemote(setup);
        const remote = transport(setup.control, setup.snapshot);
        remote.commit.mockRejectedValueOnce(new CloudReplicaTransportError(409));
        remote.commitOutcome.mockResolvedValueOnce({ outcome: 'not-committed', currentRevision: control.revision });
        remote.control.mockResolvedValue({ ...control, uid: 'other-owner' });
        const bytes = await get(storeKey);
        await expect(deliverCloudflareJournalCandidate(owner, adk, remote, 'csrf-session', () => true))
            .resolves.toBe('reconciliation-required');
        expect(remote.scanAll).not.toHaveBeenCalled();
        expect(await get(storeKey)).toBe(bytes);
    });

    it('preserves new edits made by another tab during recovery', async () => {
        const setup = await savedDelivery();
        const oldIntent = (await readLocal(owner))!.cloudflareDelivery;
        const { control, scan } = changedRemote(setup);
        const remote = transport(setup.control, setup.snapshot);
        remote.commit.mockRejectedValueOnce(new CloudReplicaTransportError(409));
        remote.commitOutcome.mockResolvedValueOnce({ outcome: 'not-committed', currentRevision: 2 });
        remote.control.mockResolvedValue(control);
        remote.scanAll.mockImplementationOnce(async () => {
            await commitLocal(owner, profile(172), profile(171));
            return scan;
        });
        expect(await deliverCloudflareJournalCandidate(owner, adk, remote, 'csrf-session', () => true))
            .toBe('retry-staged');
        const saved = (await readLocal(owner))!;
        expect(saved.pending).toHaveLength(2);
        expect(saved.pending[0]).toEqual(oldIntent!.operations[0]);
        expect(saved.data.profile?.height).toBe('172');
        expect(saved.cloudflareDelivery?.operations).toEqual(oldIntent?.operations);
        expect(saved.cloudflareDelivery?.batch.batchId).not.toBe(oldIntent?.batch.batchId);
        expect(remote.commit).toHaveBeenCalledOnce();
    });

    it('does not rotate after inconclusive or committed historical status', async () => {
        const setup = await savedDelivery();
        const before = await get(storeKey);
        const remote = transport(setup.control, setup.snapshot);
        remote.commit.mockRejectedValue(new CloudReplicaTransportError(409));
        remote.commitOutcome.mockResolvedValueOnce({ outcome: 'inconclusive', currentRevision: 0 })
            .mockResolvedValueOnce({ outcome: 'committed', currentRevision: 1 });
        for (let index = 0; index < 2; index += 1) {
            expect(await deliverCloudflareJournalCandidate(owner, adk, remote, 'csrf-session', () => true))
                .toBe('reconciliation-required');
            expect(await get(storeKey)).toBe(before);
        }
        expect(remote.control).not.toHaveBeenCalled();
        expect(remote.scanAll).not.toHaveBeenCalled();
    });

    it('rejects mismatched revision or advanced same-actor sequence before scanning', async () => {
        const setup = await savedDelivery();
        const { control } = changedRemote(setup);
        const remote = transport(setup.control, setup.snapshot);
        remote.commit.mockRejectedValue(new CloudReplicaTransportError(409));
        remote.commitOutcome.mockResolvedValue({ outcome: 'not-committed', currentRevision: 3 });
        remote.control.mockResolvedValue(control);
        const bytes = await get(storeKey);
        expect(await deliverCloudflareJournalCandidate(owner, adk, remote, 'csrf-session', () => true))
            .toBe('reconciliation-required');
        expect(await get(storeKey)).toBe(bytes);
        remote.commitOutcome.mockResolvedValue({ outcome: 'not-committed', currentRevision: 2 });
        remote.control.mockResolvedValue({
            ...control, replicas: {
                ...control.replicas, s00: { ...control.replicas.s00, lastSeq: 1 },
            },
        });
        expect(await deliverCloudflareJournalCandidate(owner, adk, remote, 'csrf-session', () => true))
            .toBe('reconciliation-required');
        expect(remote.scanAll).not.toHaveBeenCalled();
        expect(await get(storeKey)).toBe(bytes);
    });

    it('rejects tampered AEAD on an unrelated cloud document, preserving original intent', async () => {
        const setup = await savedDelivery();
        const { control, scan } = changedRemote(setup);
        const remote = transport(setup.control, setup.snapshot);
        remote.commit.mockRejectedValue(new CloudReplicaTransportError(409));
        remote.commitOutcome.mockResolvedValue({ outcome: 'not-committed', currentRevision: 2 });
        remote.control.mockResolvedValue(control);
        const wrongKey = new Uint8Array(32).fill(99);
        const forged = sealCloudDocument(wrongKey, owner.slice(5), 'nutrition_months/2026-11',
            { '2026-11-14': { date: '2026-11-14', weight: 77 } },
            { protocolVersion: 3, clock: { s01: 1 }, fields: {},
                writer: { slot: 's01', replicaId: 'other-cloud-writer', generation: 1,
                    seq: 1, consentRevision: 1 } });
        remote.scanAll.mockResolvedValue({ ...scan, documents: [{
            path: 'nutrition_months/2026-11', revision: 2, document: forged,
        }] });
        const before = await get(storeKey);
        await expect(deliverCloudflareJournalCandidate(owner, adk, remote, 'csrf-session', () => true))
            .rejects.toThrow();
        expect(await get(storeKey)).toBe(before);
        expect(remote.control).toHaveBeenCalledTimes(1);
    });

    it('rejects an unstable replica register after the authenticated scan', async () => {
        const setup = await savedDelivery();
        const { control, scan } = changedRemote(setup);
        const remote = transport(setup.control, setup.snapshot);
        remote.commit.mockRejectedValue(new CloudReplicaTransportError(409));
        remote.commitOutcome.mockResolvedValue({ outcome: 'not-committed', currentRevision: 2 });
        remote.control.mockResolvedValueOnce(control).mockResolvedValueOnce({
            ...control, revision: 3,
        });
        remote.scanAll.mockResolvedValue(scan);
        const original = await get(storeKey);
        expect(await deliverCloudflareJournalCandidate(owner, adk, remote, 'csrf-session', () => true))
            .toBe('reconciliation-required');
        expect(remote.control).toHaveBeenCalledTimes(2);
        expect(await get(storeKey)).toBe(original);
    });

    it('invalidates recovery when the Auth epoch changes while the remote scan is in flight', async () => {
        const setup = await savedDelivery();
        const { control, scan } = changedRemote(setup);
        const remote = transport(setup.control, setup.snapshot);
        let active = true;
        remote.commit.mockRejectedValue(new CloudReplicaTransportError(409));
        remote.commitOutcome.mockResolvedValue({ outcome: 'not-committed', currentRevision: 2 });
        remote.control.mockResolvedValue(control);
        remote.scanAll.mockImplementationOnce(async () => {
            active = false;
            return scan;
        });
        const original = await get(storeKey);
        await expect(deliverCloudflareJournalCandidate(owner, adk, remote, 'csrf-session', () => active))
            .rejects.toThrow('Sessione D1 cambiata');
        expect(await get(storeKey)).toBe(original);
    });
    });
}
