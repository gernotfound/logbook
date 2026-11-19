import { act, renderHook } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { useNutritionMeasurements } from '../../../src/hooks/useNutritionMeasurements';
import { useAppStore } from '../../../src/store/useAppStore';
import { invalidateSession, storageOwner } from '../../../src/lib/sync/session';
import { deviceKey, protectedDeviceKey, writeDeviceValue } from '../../../src/lib/sync/deviceStorage';
import { prepareUnlockedTestArchive } from '../../secureVaultFixture';
import { readFencedDatedDraft, readFencedDatedDraftImage, writeFencedDatedDraft } from '../../../src/lib/sync/datedDraftEpoch';
import { clearDatedWriterIntent, createDatedWriterIntentName, inspectDatedRecoveryEvidence, readDatedWriterEvidence, writeDatedWriterIntent } from '../../../src/lib/sync/datedDraftWriterIntent';
import { writerParentReference } from '../../../src/lib/sync/writerLineage';
import { mockFirebaseAuth } from '../../setup';
import { draftRegistry } from '../../../src/lib/utils/draftRegistry';
import type { SyncResult } from '../../../src/types';
import { installDatedDraftFixtures } from './datedDraftFixtures';

installDatedDraftFixtures();

describe('Recovery lineage and safe retries', () => {
it('recovers several sequential dated edits across React remounts without confusing lineage with concurrency', async () => {
    const owner = storageOwner();
    await prepareUnlockedTestArchive(owner);
    const name = 'draft:measurement:2026-09-11';
    const original = renderHook(() => useNutritionMeasurements('2026-09-11'));
    act(() => original.result.current.setWeight('75'));
    original.unmount();

    const firstRecovery = renderHook(() => useNutritionMeasurements('2026-09-11'));
    expect(firstRecovery.result.current.weight).toBe('75');
    act(() => firstRecovery.result.current.setWeight('76'));
    expect(useAppStore.getState().localPersistenceBlocked).toBe(false);
    expect(readDatedWriterEvidence(owner, name)).toHaveLength(2);
    firstRecovery.unmount();

    const secondRecovery = renderHook(() => useNutritionMeasurements('2026-09-11'));
    expect(secondRecovery.result.current.weight).toBe('76');
    act(() => secondRecovery.result.current.setWeight('77'));
    expect(useAppStore.getState().localPersistenceBlocked).toBe(false);
    const lineage = readDatedWriterEvidence(owner, name);
    expect(lineage).toHaveLength(3);
    const names = lineage.map(x => x.name);
    expect(names.every(x => localStorage.getItem(protectedDeviceKey(x, owner))?.startsWith('tlb-sealed:v1:'))).toBe(true);
    expect(localStorage.getItem(protectedDeviceKey(name, owner))).toMatch(/^tlb-sealed:v1:/);
    expect(localStorage.getItem(deviceKey(name, owner))).toBeNull();
    secondRecovery.unmount();

    const dispatch = vi.fn().mockResolvedValue({ ok: true, status: 'synced' } as SyncResult);
    useAppStore.setState({ dispatchDomainOperation: dispatch });
    const confirmed = renderHook(() => useNutritionMeasurements('2026-09-11'));
    expect(confirmed.result.current.weight).toBe('77');
    await act(async () => { await confirmed.result.current.calculateAndSave(); });
    expect(dispatch).toHaveBeenCalledTimes(1);
    expect(readFencedDatedDraft(name, owner)).toBeNull();
    expect(readDatedWriterEvidence(owner, name)).toEqual([]);
    expect(names.every(x => localStorage.getItem(protectedDeviceKey(x, owner)) === null)).toBe(true);
    expect(localStorage.getItem(protectedDeviceKey(name, owner))).toMatch(/^tlb-sealed:v1:/);
    expect(readFencedDatedDraftImage(name, owner).raw).toContain('"values":null');
    confirmed.unmount();
});

it('rejects sibling dated successors rather than adopting a concurrent shared draft', async () => {
    const owner = storageOwner();
    await prepareUnlockedTestArchive(owner);
    const name = 'draft:measurement:2026-09-11';
    const original = renderHook(() => useNutritionMeasurements('2026-09-11'));
    act(() => original.result.current.setWeight('75'));
    original.unmount();
    const [source] = readDatedWriterEvidence(owner, name);
    const parent = writerParentReference(source);
    const a = createDatedWriterIntentName();
    const b = createDatedWriterIntentName();
    writeDatedWriterIntent(a, owner, name, { weight: '76' }, null, undefined, parent);
    writeDatedWriterIntent(b, owner, name, { weight: '77' }, null, undefined, parent);
    const before = readFencedDatedDraftImage(name, owner).raw;
    writeFencedDatedDraft(name, owner, { weight: '77' }, before);

    const names = [source.name, a, b, name];
    const bytes = names.map(x => localStorage.getItem(protectedDeviceKey(x, owner)));
    expect(bytes.every(raw => raw?.startsWith('tlb-sealed:v1:'))).toBe(true);
    const recovery = renderHook(() => useNutritionMeasurements('2026-09-11'));
    expect(recovery.result.current.weight).toBe('');
    expect(useAppStore.getState().localPersistenceBlocked).toBe(true);
    expect(readDatedWriterEvidence(owner, name)).toHaveLength(3);
    names.forEach((x, i) => {
        expect(localStorage.getItem(protectedDeviceKey(x, owner))).toBe(bytes[i]);
        expect(localStorage.getItem(deviceKey(x, owner))).toBeNull();
    });
    recovery.unmount();
});

it('fails closed when a dated successor references a missing predecessor', async () => {
    const owner = storageOwner();
    await prepareUnlockedTestArchive(owner);
    const name = 'draft:measurement:2026-09-11';
    const original = renderHook(() => useNutritionMeasurements('2026-09-11'));
    act(() => original.result.current.setWeight('75'));
    original.unmount();
    const [source] = readDatedWriterEvidence(owner, name);
    const next = createDatedWriterIntentName();
    writeDatedWriterIntent(next, owner, name, { weight: '76' },
        null, undefined, writerParentReference(source));
    writeFencedDatedDraft(name, owner, { weight: '76' },
        readFencedDatedDraftImage(name, owner).raw);
    const successorCipher = localStorage.getItem(protectedDeviceKey(next, owner));
    expect(successorCipher).toMatch(/^tlb-sealed:v1:/);
    localStorage.removeItem(protectedDeviceKey(source.name, owner));

    const recovery = renderHook(() => useNutritionMeasurements('2026-09-11'));
    expect(recovery.result.current.weight).toBe('');
    expect(useAppStore.getState().localPersistenceBlocked).toBe(true);
    expect(readDatedWriterEvidence(owner, name)).toHaveLength(1);
    expect(localStorage.getItem(protectedDeviceKey(next, owner))).toBe(successorCipher);
    expect(localStorage.getItem(deviceKey(source.name, owner))).toBeNull();
    expect(localStorage.getItem(deviceKey(next, owner))).toBeNull();
    recovery.unmount();
});

it('does not create a new writer when an untouched recovered draft is flushed', async () => {
    const owner = storageOwner();
    await prepareUnlockedTestArchive(owner);
    const name = 'draft:measurement:2026-09-11';
    const sealedKey = protectedDeviceKey(name, owner);
    const initial = renderHook(() => useNutritionMeasurements('2026-09-11'));
    act(() => initial.result.current.setWeight('75'));
    initial.unmount();
    const before = readDatedWriterEvidence(owner, name);
    expect(before).toHaveLength(1);
    const canonical = readFencedDatedDraftImage(name, owner).raw;
    const ciphertext = localStorage.getItem(sealedKey);
    expect(ciphertext).toMatch(/^tlb-sealed:v1:/);
    expect(localStorage.getItem(deviceKey(name, owner))).toBeNull();

    const recovered = renderHook(() => useNutritionMeasurements('2026-09-11'));
    expect(recovered.result.current.weight).toBe('75');
    act(() => draftRegistry.flushAll({ strict: true }));
    expect(readDatedWriterEvidence(owner, name)).toEqual(before);
    expect(readFencedDatedDraftImage(name, owner).raw).toBe(canonical);
    expect(localStorage.getItem(sealedKey)).toBe(ciphertext);
    expect(localStorage.getItem(deviceKey(name, owner))).toBeNull();
    expect(useAppStore.getState().localPersistenceBlocked).toBe(false);
    recovered.unmount();
});

it('does not rewrite an already persisted user edit during later background or update flushes', async () => {
    const owner = storageOwner();
    await prepareUnlockedTestArchive(owner);
    const name = 'draft:measurement:2026-09-11';
    const canonicalKey = protectedDeviceKey(name, owner);
    const hook = renderHook(() => useNutritionMeasurements('2026-09-11'));
    act(() => hook.result.current.setWeight('75'));

    const canonical = readFencedDatedDraftImage(name, owner).raw;
    const ciphertext = localStorage.getItem(canonicalKey);
    const witnesses = readDatedWriterEvidence(owner, name);
    expect(witnesses).toHaveLength(1);
    expect(witnesses[0].values.weight).toBe('75');
    expect(ciphertext).toMatch(/^tlb-sealed:v1:/);

    act(() => draftRegistry.flushAll({ strict: true }));
    hook.rerender();
    act(() => draftRegistry.flushAll({ strict: true }));
    expect(readFencedDatedDraftImage(name, owner).raw).toBe(canonical);
    expect(localStorage.getItem(canonicalKey)).toBe(ciphertext);
    expect(readDatedWriterEvidence(owner, name)).toEqual(witnesses);

    act(() => hook.result.current.setWeight('76'));
    expect(readFencedDatedDraftImage(name, owner).raw).not.toBe(canonical);
    expect(readDatedWriterEvidence(owner, name)).toHaveLength(1);
    hook.unmount();
});

it('rejects an unchanged dated form during required-update capture if another tab replaced its record', async () => {
    const owner = storageOwner();
    await prepareUnlockedTestArchive(owner);
    const name = 'draft:measurement:2026-09-11';
    const editor = renderHook(() => useNutritionMeasurements('2026-09-11'));
    act(() => editor.result.current.setWeight('75'));
    const observed = readFencedDatedDraftImage(name, owner).raw;
    const replacement = writeFencedDatedDraft(name, owner, { weight: '85' }, observed);
    expect(() => draftRegistry.flushAll({ strict: true })).toThrow(AggregateError);
    expect(readFencedDatedDraftImage(name, owner).raw).toBe(replacement);
    editor.unmount();
});

it('preserves a mounted old editor\'s next edit when a second confirmed form consumed its witness', async () => {
    const owner = storageOwner();
    await prepareUnlockedTestArchive(owner);
    const name = 'draft:measurement:2026-09-11';
    const dispatch = vi.fn().mockResolvedValue({ ok: true, status: 'synced' } as SyncResult);
    useAppStore.setState({ dispatchDomainOperation: dispatch });
    const original = renderHook(() => useNutritionMeasurements('2026-09-11'));
    act(() => original.result.current.setWeight('75'));
    const [originalWitness] = readDatedWriterEvidence(owner, name);
    expect(originalWitness.values.weight).toBe('75');
    const originalCiphertext = localStorage.getItem(protectedDeviceKey(originalWitness.name, owner));
    expect(originalCiphertext).toMatch(/^tlb-sealed:v1:/);
    expect(localStorage.getItem(deviceKey(originalWitness.name, owner))).toBeNull();

    const confirmer = renderHook(() => useNutritionMeasurements('2026-09-11'));
    expect(confirmer.result.current.weight).toBe('75');
    act(() => confirmer.result.current.setWeight('76'));
    await act(async () => { await confirmer.result.current.calculateAndSave(); });
    expect(dispatch).toHaveBeenCalledTimes(1);
    expect(readFencedDatedDraft(name, owner)).toBeNull();
    expect(readDatedWriterEvidence(owner, name)).toHaveLength(0);
    const tombstone = localStorage.getItem(protectedDeviceKey(name, owner));
    expect(tombstone).toMatch(/^tlb-sealed:v1:/);
    expect(localStorage.getItem(protectedDeviceKey(originalWitness.name, owner))).toBeNull();

    // The first mounted form's slot has been consumed by a different
    // acknowledged editor. Its NEW keystroke must be resealed under a new
    // independent key before failing the stale canonical-image check.
    act(() => original.result.current.setWeight('77'));
    const [newWitness] = readDatedWriterEvidence(owner, name);
    expect(newWitness.name).not.toBe(originalWitness.name);
    expect(newWitness.values.weight).toBe('77');
    expect(localStorage.getItem(protectedDeviceKey(newWitness.name, owner))).toMatch(/^tlb-sealed:v1:/);
    expect(localStorage.getItem(deviceKey(newWitness.name, owner))).toBeNull();
    expect(readFencedDatedDraft(name, owner)).toBeNull();
    expect(localStorage.getItem(protectedDeviceKey(name, owner))).toBe(tombstone);
    expect(localStorage.getItem(deviceKey(name, owner))).toBeNull();
    expect(useAppStore.getState().localPersistenceBlocked).toBe(true);
    expect(dispatch).toHaveBeenCalledTimes(1);
    original.unmount();
    confirmer.unmount();
});

it('removes only committed editor evidence after durable business save', async () => {
    const owner = storageOwner();
    await prepareUnlockedTestArchive(owner);
    const name = 'draft:measurement:2026-09-11';
    const dispatch = vi.fn().mockResolvedValue({ ok: true, status: 'synced' } as SyncResult);
    useAppStore.setState({ dispatchDomainOperation: dispatch });
    const hook = renderHook(() => useNutritionMeasurements('2026-09-11'));
    act(() => hook.result.current.setWeight('75'));
    const [witness] = readDatedWriterEvidence(owner, name);
    expect(witness.values.weight).toBe('75');
    expect(localStorage.getItem(protectedDeviceKey(witness.name, owner))).toMatch(/^tlb-sealed:v1:/);
    expect(localStorage.getItem(deviceKey(witness.name, owner))).toBeNull();
    await act(async () => { await hook.result.current.calculateAndSave(); });
    expect(dispatch).toHaveBeenCalledTimes(1);
    expect(readDatedWriterEvidence(owner, name)).toHaveLength(0);
    expect(readFencedDatedDraftImage(name, owner).values).toBeNull();
    expect(localStorage.getItem(protectedDeviceKey(witness.name, owner))).toBeNull();
    expect(localStorage.getItem(protectedDeviceKey(name, owner))).toMatch(/^tlb-sealed:v1:/);
    expect(localStorage.getItem(deviceKey(name, owner))).toBeNull();
    hook.unmount();
});

it('quarantines an unstamped account witness at epoch 1 but retains read-only recovery evidence', async () => {
    localStorage.removeItem('logbook_is_guest');
    invalidateSession();
    const owner = 'user:' + mockFirebaseAuth.currentUser!.uid;
    const name = 'draft:measurement:2026-09-11';
    const unrelated = 'draft:sleep:2026-09-11';
    localStorage.setItem(deviceKey('health-consent-generation', owner), '1');
    await prepareUnlockedTestArchive(owner);
    const witness = createDatedWriterIntentName();
    const raw = JSON.stringify({
        __logbookDatedWriterIntent: 1, owner, draftName: name,
        values: { weight: '75' }, revisionId: 'a'.repeat(32),
    });
    writeDeviceValue(witness, raw, owner);
    const sealedKey = protectedDeviceKey(witness, owner);
    const ciphertext = localStorage.getItem(sealedKey);
    expect(ciphertext).toMatch(/^tlb-sealed:v1:/);

    expect(() => readDatedWriterEvidence(owner, name))
        .toThrow('Copia datata account senza revisione consenso');
    expect(() => writeDatedWriterIntent(witness, owner, name, { weight: '80' }, raw, '1'))
        .toThrow('Copia datata account senza revisione consenso');
    expect(() => clearDatedWriterIntent(witness, owner, raw, '1'))
        .toThrow('Copia datata account senza revisione consenso');

    // Invalid provenance for a different field must not suppress valid evidence.
    const other = createDatedWriterIntentName();
    const current = writeDatedWriterIntent(other, owner, unrelated, { sleepHours: '08:00' }, null, '1');
    expect(JSON.parse(current).consentRevision).toBe(1);
    expect(readDatedWriterEvidence(owner, unrelated)).toHaveLength(1);
    const preview = inspectDatedRecoveryEvidence(owner);
    expect(preview.find(entry => entry.name === witness)).toMatchObject({
        consentRevision: null, provenance: 'unknown',
    });
    expect(preview.find(entry => entry.name === witness)?.value).toContain('"weight": "75"');
    expect(preview.find(entry => entry.name === other)?.provenance).toBe('current');

    const hook = renderHook(() => useNutritionMeasurements('2026-09-11'));
    expect(useAppStore.getState().localPersistenceBlocked).toBe(true);
    act(() => hook.result.current.setWeight('90'));
    expect(localStorage.getItem(sealedKey)).toBe(ciphertext);
    expect(localStorage.getItem(deviceKey(witness, owner))).toBeNull();
    hook.unmount();
});

it('refuses new unstamped account witnesses without consent marker and accepts the current stamped format', async () => {
    localStorage.removeItem('logbook_is_guest');
    invalidateSession();
    const owner = 'user:' + mockFirebaseAuth.currentUser!.uid;
    const name = 'draft:measurement:2026-09-11';
    const witness = createDatedWriterIntentName();
    const marker = deviceKey('health-consent-generation', owner);
    localStorage.removeItem(marker);
    await prepareUnlockedTestArchive(owner);
    expect(() => writeDatedWriterIntent(witness, owner, name, { weight: '75' }, null))
        .toThrow('Generazione consenso copia datata non verificabile');
    expect(localStorage.getItem(protectedDeviceKey(witness, owner))).toBeNull();

    localStorage.setItem(marker, '1');
    const raw = writeDatedWriterIntent(witness, owner, name, { weight: '75' }, null, '1');
    expect(JSON.parse(raw)).toMatchObject({
        __logbookDatedWriterIntent: 1, owner, draftName: name,
        consentRevision: 1, values: { weight: '75' },
    });
    expect(readDatedWriterEvidence(owner, name)).toHaveLength(1);
    clearDatedWriterIntent(witness, owner, raw, '1');
    expect(readDatedWriterEvidence(owner, name)).toEqual([]);
});

it('quarantines consent-revoked writer evidence while retaining its bytes for explicit export', async () => {
    localStorage.removeItem('logbook_is_guest');
    invalidateSession();
    const owner = 'user:' + mockFirebaseAuth.currentUser!.uid;
    await prepareUnlockedTestArchive(owner);
    const name = 'draft:measurement:2026-09-11';
    const marker = `logbook:v2:${owner}:health-consent-generation`;
    localStorage.setItem(marker, '3');
    const witness = createDatedWriterIntentName();
    const raw = writeDatedWriterIntent(witness, owner, name, { weight: '75' }, null, '3');
    const ciphertext = localStorage.getItem(protectedDeviceKey(witness, owner));
    expect(ciphertext).toMatch(/^tlb-sealed:v1:/);
    localStorage.setItem(marker, '5');
    expect(() => readDatedWriterEvidence(owner, name)).toThrow();
    const preview = inspectDatedRecoveryEvidence(owner);
    expect(preview).toHaveLength(1);
    expect(preview[0].provenance).toBe('previous');
    expect(preview[0].value).toContain('75');
    expect(localStorage.getItem(protectedDeviceKey(witness, owner))).toBe(ciphertext);
    expect(localStorage.getItem(deviceKey(witness, owner))).toBeNull();
    expect(JSON.parse(raw)).toMatchObject({ values: { weight: '75' }, consentRevision: 3 });
});

it('blocks malformed dated writer witness rather than treating recovery storage as empty', () => {
    const owner = storageOwner();
    const name = 'draft:measurement:2026-09-11';
    const witness = createDatedWriterIntentName();
    const original = '{"__logbookDatedWriterIntent":1,"owner":"guest","draftName":"foreign","values":{"weight":"75"}}';
    const key = deviceKey(witness, owner);
    localStorage.setItem(key, original);
    expect(() => readDatedWriterEvidence(owner, name)).toThrow();
    expect(localStorage.getItem(key)).toBe(original);
});

it('advances the observed image after consecutive edits and clears only its own committed draft', async () => {
    const owner = storageOwner();
    await prepareUnlockedTestArchive(owner);
    const name = 'draft:measurement:2026-09-11';
    const sealedKey = protectedDeviceKey(name, owner);
    const dispatch = vi.fn().mockResolvedValue({ ok: true, status: 'synced' } as SyncResult);
    useAppStore.setState({ dispatchDomainOperation: dispatch });
    const hook = renderHook(() => useNutritionMeasurements('2026-09-11'));
    act(() => hook.result.current.setWeight('75'));
    const first = readFencedDatedDraftImage(name, owner).raw;
    const firstCiphertext = localStorage.getItem(sealedKey);
    expect(firstCiphertext).toMatch(/^tlb-sealed:v1:/);
    act(() => hook.result.current.setWeight('76'));
    const second = readFencedDatedDraftImage(name, owner).raw;
    const secondCiphertext = localStorage.getItem(sealedKey);
    expect(second).not.toBe(first);
    expect(secondCiphertext).toMatch(/^tlb-sealed:v1:/);
    expect(secondCiphertext).not.toBe(firstCiphertext);
    expect(localStorage.getItem(deviceKey(name, owner))).toBeNull();
    expect(useAppStore.getState().localPersistenceBlocked).toBe(false);

    await act(async () => { await hook.result.current.calculateAndSave(); });
    expect(dispatch).toHaveBeenCalledTimes(1);
    expect(readFencedDatedDraft(name, owner)).toBeNull();
    expect(readFencedDatedDraftImage(name, owner).raw).toContain('"values":null');
    expect(localStorage.getItem(sealedKey)).toMatch(/^tlb-sealed:v1:/);
    expect(localStorage.getItem(sealedKey)).not.toBe(secondCiphertext);
    expect(localStorage.getItem(deviceKey(name, owner))).toBeNull();
    expect(useAppStore.getState().localPersistenceBlocked).toBe(false);
});

it('allows the same mounted form to edit again after a confirmed save and retained tombstone', async () => {
    const owner = storageOwner();
    await prepareUnlockedTestArchive(owner);
    const name = 'draft:measurement:2026-09-11';
    const sealedKey = protectedDeviceKey(name, owner);
    const dispatch = vi.fn().mockResolvedValue({ ok: true, status: 'synced' } as SyncResult);
    useAppStore.setState({ dispatchDomainOperation: dispatch });
    const hook = renderHook(() => useNutritionMeasurements('2026-09-11'));
    act(() => hook.result.current.setWeight('75'));
    await act(async () => { await hook.result.current.calculateAndSave(); });
    const deleted = readFencedDatedDraftImage(name, owner);
    expect(deleted.values).toBeNull();
    expect(deleted.raw).not.toBeNull();
    const deletedCiphertext = localStorage.getItem(sealedKey);
    expect(deletedCiphertext).toMatch(/^tlb-sealed:v1:/);

    act(() => hook.result.current.setWeight('76'));
    expect(readFencedDatedDraft(name, owner)?.weight).toBe('76');
    expect(readFencedDatedDraftImage(name, owner).raw).not.toBe(deleted.raw);
    expect(localStorage.getItem(sealedKey)).toMatch(/^tlb-sealed:v1:/);
    expect(localStorage.getItem(sealedKey)).not.toBe(deletedCiphertext);
    expect(localStorage.getItem(deviceKey(name, owner))).toBeNull();
    expect(useAppStore.getState().localPersistenceBlocked).toBe(false);
    hook.unmount();
});
});
