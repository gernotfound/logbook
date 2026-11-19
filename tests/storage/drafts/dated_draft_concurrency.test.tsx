import { act, renderHook } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { useNutritionMeasurements } from '../../../src/hooks/useNutritionMeasurements';
import { useAppStore } from '../../../src/store/useAppStore';
import { invalidateSession, storageOwner } from '../../../src/lib/sync/session';
import { deviceKey, protectedDeviceKey } from '../../../src/lib/sync/deviceStorage';
import { prepareUnlockedTestArchive } from '../../secureVaultFixture';
import { readFencedDatedDraft, readFencedDatedDraftImage, writeFencedDatedDraft } from '../../../src/lib/sync/datedDraftEpoch';
import { createDatedWriterIntentName, inspectDatedRecoveryEvidence, readDatedWriterEvidence, writeDatedWriterIntent } from '../../../src/lib/sync/datedDraftWriterIntent';
import { mockFirebaseAuth } from '../../setup';
import { draftRegistry } from '../../../src/lib/utils/draftRegistry';
import type { SyncResult } from '../../../src/types';
import { installDatedDraftFixtures, storeItem } from './datedDraftFixtures';

installDatedDraftFixtures();

describe('Concurrent writers and witness integrity', () => {
it('blocks a stale mounted measurement form before edit or business dispatch, preserving the newer device record', async () => {
    const owner = storageOwner();
    await prepareUnlockedTestArchive(owner);
    const name = 'draft:measurement:2026-09-11';
    writeFencedDatedDraft(name, owner, { weight: '75' });
    const dispatch = vi.fn().mockResolvedValue({ ok: true, status: 'synced' } as SyncResult);
    useAppStore.setState({ dispatchDomainOperation: dispatch });
    const earlier = renderHook(() => useNutritionMeasurements('2026-09-11'));
    const stale = renderHook(() => useNutritionMeasurements('2026-09-11'));
    expect(stale.result.current.weight).toBe('75');

    act(() => earlier.result.current.setWeight('76'));
    const currentRaw = readFencedDatedDraftImage(name, owner).raw;
    const ciphertext = localStorage.getItem(protectedDeviceKey(name, owner));
    expect(ciphertext).toMatch(/^tlb-sealed:v1:/);
    expect(localStorage.getItem(deviceKey(name, owner))).toBeNull();

    act(() => stale.result.current.setWaist('85'));
    expect(stale.result.current.waist).toBe('85'); // keep fresh text in its own witness
    expect(useAppStore.getState().localPersistenceBlocked).toBe(true);
    expect(useAppStore.getState().saveError).toMatch(/altra scheda/i);
    await act(async () => { await stale.result.current.calculateAndSave(); });
    expect(dispatch).not.toHaveBeenCalled();
    expect(readFencedDatedDraftImage(name, owner).raw).toBe(currentRaw);
    expect(readFencedDatedDraft(name, owner)?.weight).toBe('76');
    expect(localStorage.getItem(protectedDeviceKey(name, owner))).toBe(ciphertext);
    expect(localStorage.getItem(deviceKey(name, owner))).toBeNull();
    const witnesses = readDatedWriterEvidence(owner, name);
    expect(witnesses.map(x => x.values.weight).sort()).toEqual(['76', '75'].sort());
    expect(witnesses.every(x => localStorage.getItem(protectedDeviceKey(x.name, owner))?.startsWith('tlb-sealed:v1:'))).toBe(true);
    earlier.unmount();
    stale.unmount();
});

it('preserves both editors independently when a stale form cannot update the shared dated draft', async () => {
    const owner = storageOwner();
    await prepareUnlockedTestArchive(owner);
    const name = 'draft:measurement:2026-09-11';
    const first = renderHook(() => useNutritionMeasurements('2026-09-11'));
    const second = renderHook(() => useNutritionMeasurements('2026-09-11'));
    act(() => first.result.current.setWeight('75'));
    act(() => second.result.current.setWeight('76'));
    expect(readFencedDatedDraft(name, owner)?.weight).toBe('75');
    const ciphertext = localStorage.getItem(protectedDeviceKey(name, owner));
    expect(ciphertext).toMatch(/^tlb-sealed:v1:/);
    expect(localStorage.getItem(deviceKey(name, owner))).toBeNull();
    const witnesses = readDatedWriterEvidence(owner, name);
    expect(witnesses.map(x => x.values.weight).sort()).toEqual(['75', '76']);
    expect(witnesses.every(x => localStorage.getItem(protectedDeviceKey(x.name, owner))?.startsWith('tlb-sealed:v1:'))).toBe(true);
    expect(witnesses.every(x => localStorage.getItem(deviceKey(x.name, owner)) === null)).toBe(true);
    expect(useAppStore.getState().localPersistenceBlocked).toBe(true);

    // An independent new editor cannot silently choose or republish either contender.
    first.unmount(); second.unmount();
    const reopened = renderHook(() => useNutritionMeasurements('2026-09-11'));
    expect(reopened.result.current.weight).toBe('');
    expect(readDatedWriterEvidence(owner, name)).toHaveLength(2);
    expect(localStorage.getItem(protectedDeviceKey(name, owner))).toBe(ciphertext);
    reopened.unmount();
});

it('retains two full writer values even if the shared canonical record is forcibly lost in a simultaneous race', async () => {
    const owner = storageOwner();
    await prepareUnlockedTestArchive(owner);
    const name = 'draft:sleep:2026-09-11';
    const a = createDatedWriterIntentName();
    const b = createDatedWriterIntentName();
    writeDatedWriterIntent(a, owner, name, { sleepHours: '07:00' }, null);
    writeDatedWriterIntent(b, owner, name, { sleepHours: '08:00' }, null);
    // Deliberately emulate two writers which both passed their preflight
    // before either canonical write (localStorage has no atomic CAS).
    writeFencedDatedDraft(name, owner, { sleepHours: '07:00' });
    writeFencedDatedDraft(name, owner, { sleepHours: '08:00' });
    expect(readFencedDatedDraft(name, owner)?.sleepHours).toBe('08:00');
    expect(readDatedWriterEvidence(owner, name).map(x => x.values.sleepHours).sort())
        .toEqual(['07:00', '08:00']);
    const inspected = inspectDatedRecoveryEvidence(owner);
    expect(inspected).toHaveLength(2);
    expect(inspected.map(x => JSON.parse(x.value).sleepHours).sort()).toEqual(['07:00', '08:00']);
    const names = [a, b, name];
    expect(names.every(x => localStorage.getItem(protectedDeviceKey(x, owner))?.startsWith('tlb-sealed:v1:'))).toBe(true);
    expect(names.every(x => localStorage.getItem(deviceKey(x, owner)) === null)).toBe(true);
});

it('refuses a dated evidence read when an unrelated writer changes after authentication', async () => {
    const owner = storageOwner();
    await prepareUnlockedTestArchive(owner);
    const field = 'draft:measurement:2026-09-11';
    const unrelated = 'draft:sleep:2026-09-11';
    const otherWriter = createDatedWriterIntentName();
    const chosenWriter = createDatedWriterIntentName();
    const original = writeDatedWriterIntent(otherWriter, owner, unrelated, { sleepHours: '07:00' }, null);
    const originalCiphertext = localStorage.getItem(protectedDeviceKey(otherWriter, owner));
    expect(originalCiphertext).toMatch(/^tlb-sealed:v1:/);
    writeDatedWriterIntent(chosenWriter, owner, field, { weight: '75' }, null);

    const read = vi.mocked(localStorage.getItem);
    const originalRead = read.getMockImplementation();
    if (!originalRead) throw new Error('Missing localStorage mock implementation');
    let updated = false;
    read.mockImplementation((key: string) => {
        const value = originalRead(key);
        if (!updated && key === protectedDeviceKey(chosenWriter, owner)) {
            updated = true;
            writeDatedWriterIntent(otherWriter, owner, unrelated, { sleepHours: '08:00' }, original);
        }
        return value;
    });
    try {
        expect(() => readDatedWriterEvidence(owner, field)).toThrow('Copia datata modificata durante la verifica.');
    } finally {
        read.mockImplementation(originalRead);
    }
    expect(updated).toBe(true);
    expect(readDatedWriterEvidence(owner, field).map(x => x.values.weight)).toEqual(['75']);
    expect(readDatedWriterEvidence(owner, unrelated).map(x => x.values.sleepHours)).toEqual(['08:00']);
    expect(localStorage.getItem(protectedDeviceKey(otherWriter, owner))).toMatch(/^tlb-sealed:v1:/);
    expect(localStorage.getItem(protectedDeviceKey(otherWriter, owner))).not.toBe(originalCiphertext);
    expect(localStorage.getItem(deviceKey(otherWriter, owner))).toBeNull();
    expect(localStorage.getItem(deviceKey(chosenWriter, owner))).toBeNull();
});

it('rejects consent revision changes during the final dated writer inventory', async () => {
    localStorage.removeItem('logbook_is_guest');
    invalidateSession();
    const owner = 'user:' + mockFirebaseAuth.currentUser!.uid;
    await prepareUnlockedTestArchive(owner);
    const field = 'draft:measurement:2026-09-11';
    const revisionKey = deviceKey('health-consent-generation', owner);
    localStorage.setItem(revisionKey, '3');
    const writer = createDatedWriterIntentName();
    const raw = writeDatedWriterIntent(writer, owner, field, { weight: '75' }, null, '3');
    const writerKey = protectedDeviceKey(writer, owner);
    const ciphertext = localStorage.getItem(writerKey);
    expect(ciphertext).toMatch(/^tlb-sealed:v1:/);

    const keyMock = vi.mocked(localStorage.key);
    const originalKey = keyMock.getMockImplementation();
    if (!originalKey) throw new Error('Missing localStorage key mock implementation');
    let appearances = 0;
    keyMock.mockImplementation((index: number) => {
        const key = originalKey(index);
        if (key === writerKey && ++appearances === 3) {
            // Two index passes establish the first stable inventory. A second
            // browser tab reaccepts consent while the final scan is underway.
            localStorage.setItem(revisionKey, '5');
        }
        return key;
    });
    try {
        expect(() => readDatedWriterEvidence(owner, field)).toThrow('Copie datate o consenso cambiati');
    } finally {
        keyMock.mockImplementation(originalKey);
    }
    expect(appearances).toBeGreaterThanOrEqual(3);
    expect(localStorage.getItem(writerKey)).toBe(ciphertext);
    expect(localStorage.getItem(deviceKey(writer, owner))).toBeNull();
    expect(JSON.parse(raw)).toMatchObject({ values: { weight: '75' }, consentRevision: 3 });
    expect(inspectDatedRecoveryEvidence(owner)[0].provenance).toBe('previous');
});

it('rejects a consent change during the last authenticated dated witness read', async () => {
    localStorage.removeItem('logbook_is_guest');
    invalidateSession();
    const owner = 'user:' + mockFirebaseAuth.currentUser!.uid;
    await prepareUnlockedTestArchive(owner);
    const field = 'draft:measurement:2026-09-11';
    const revisionKey = deviceKey('health-consent-generation', owner);
    localStorage.setItem(revisionKey, '3');
    const witness = createDatedWriterIntentName();
    const raw = writeDatedWriterIntent(witness, owner, field, { weight: '75' }, null, '3');
    const name = protectedDeviceKey(witness, owner);
    const ciphertext = localStorage.getItem(name);
    expect(ciphertext).toMatch(/^tlb-sealed:v1:/);

    const getter = vi.mocked(localStorage.getItem);
    const originalGet = getter.getMockImplementation();
    if (!originalGet) throw new Error('Missing localStorage mock implementation');
    let witnessReads = 0;
    getter.mockImplementation((key: string) => {
        const value = originalGet(key);
        if (key === name && ++witnessReads === 2) {
            localStorage.setItem(revisionKey, '5');
        }
        return value;
    });
    try {
        expect(() => readDatedWriterEvidence(owner, field)).toThrow('Copie datate o consenso cambiati');
    } finally {
        getter.mockImplementation(originalGet);
    }
    expect(witnessReads).toBe(2);
    expect(localStorage.getItem(name)).toBe(ciphertext);
    expect(localStorage.getItem(deviceKey(witness, owner))).toBeNull();
    expect(JSON.parse(raw)).toMatchObject({ values: { weight: '75' }, consentRevision: 3 });
    expect(inspectDatedRecoveryEvidence(owner)[0].provenance).toBe('previous');
});

it('rejects a consent change during the final dated recovery inspection read', async () => {
    localStorage.removeItem('logbook_is_guest');
    invalidateSession();
    const owner = 'user:' + mockFirebaseAuth.currentUser!.uid;
    await prepareUnlockedTestArchive(owner);
    const field = 'draft:measurement:2026-09-11';
    const revisionKey = deviceKey('health-consent-generation', owner);
    localStorage.setItem(revisionKey, '3');
    const witness = createDatedWriterIntentName();
    const raw = writeDatedWriterIntent(witness, owner, field, { weight: '75' }, null, '3');
    const name = protectedDeviceKey(witness, owner);
    const ciphertext = localStorage.getItem(name);
    expect(ciphertext).toMatch(/^tlb-sealed:v1:/);

    const getter = vi.mocked(localStorage.getItem);
    const originalGet = getter.getMockImplementation();
    if (!originalGet) throw new Error('Missing localStorage mock implementation');
    let witnessReads = 0;
    getter.mockImplementation((key: string) => {
        const value = originalGet(key);
        if (key === name && ++witnessReads === 2) {
            localStorage.setItem(revisionKey, '5');
        }
        return value;
    });
    try {
        expect(() => inspectDatedRecoveryEvidence(owner)).toThrow('Copie o consenso cambiati');
    } finally {
        getter.mockImplementation(originalGet);
    }
    expect(witnessReads).toBe(2);
    expect(localStorage.getItem(name)).toBe(ciphertext);
    expect(localStorage.getItem(deviceKey(witness, owner))).toBeNull();
    expect(JSON.parse(raw)).toMatchObject({ values: { weight: '75' }, consentRevision: 3 });
    expect(inspectDatedRecoveryEvidence(owner)[0].provenance).toBe('previous');
});

it('preserves dated writer witnesses when another tab compacts the key inventory', async () => {
    const owner = storageOwner();
    await prepareUnlockedTestArchive(owner);
    const draftName = 'draft:measurement:2026-09-11';
    const unrelated = 'cross-tab:transient-' + crypto.randomUUID();
    localStorage.setItem(unrelated, 'present');
    const a = createDatedWriterIntentName();
    const b = createDatedWriterIntentName();
    writeDatedWriterIntent(a, owner, draftName, { weight: '75' }, null);
    writeDatedWriterIntent(b, owner, draftName, { weight: '76' }, null);
    const cipherA = localStorage.getItem(protectedDeviceKey(a, owner));
    const cipherB = localStorage.getItem(protectedDeviceKey(b, owner));
    expect(cipherA).toMatch(/^tlb-sealed:v1:/);
    expect(cipherB).toMatch(/^tlb-sealed:v1:/);

    const keyMock = vi.mocked(localStorage.key);
    const originalKey = keyMock.getMockImplementation();
    if (!originalKey) throw new Error('Missing localStorage mock implementation');
    let compacted = false;
    keyMock.mockImplementation((index: number) => {
        const found = originalKey(index);
        if (!compacted && found === unrelated) {
            compacted = true;
            localStorage.removeItem(unrelated);
        }
        return found;
    });
    try {
        expect(() => readDatedWriterEvidence(owner, draftName))
            .toThrow('Elenco copie datate modificato');
    } finally {
        keyMock.mockImplementation(originalKey);
    }

    expect(compacted).toBe(true);
    expect(readDatedWriterEvidence(owner, draftName).map(x => x.values.weight).sort())
        .toEqual(['75', '76']);
    expect(localStorage.getItem(protectedDeviceKey(a, owner))).toBe(cipherA);
    expect(localStorage.getItem(protectedDeviceKey(b, owner))).toBe(cipherB);
    expect(localStorage.getItem(deviceKey(a, owner))).toBeNull();
    expect(localStorage.getItem(deviceKey(b, owner))).toBeNull();
});

it('keeps an independent witness readable if a canonical write exhausts storage quota', async () => {
    const owner = storageOwner();
    await prepareUnlockedTestArchive(owner);
    const name = 'draft:measurement:2026-09-11';
    const canonical = protectedDeviceKey(name, owner);
    const hook = renderHook(() => useNutritionMeasurements('2026-09-11'));
    vi.mocked(localStorage.setItem).mockImplementation((key, value) => {
        if (key === canonical) throw new DOMException('Quota exceeded', 'QuotaExceededError');
        storeItem(key, value);
    });
    act(() => hook.result.current.setWeight('75'));
    expect(readFencedDatedDraft(name, owner)).toBeNull();
    const witnesses = readDatedWriterEvidence(owner, name);
    expect(witnesses.map(x => x.values.weight)).toEqual(['75']);
    expect(localStorage.getItem(canonical)).toBeNull();
    expect(localStorage.getItem(deviceKey(name, owner))).toBeNull();
    expect(localStorage.getItem(protectedDeviceKey(witnesses[0].name, owner))).toMatch(/^tlb-sealed:v1:/);
    expect(localStorage.getItem(deviceKey(witnesses[0].name, owner))).toBeNull();
    expect(() => draftRegistry.flushAll({ strict: true })).toThrow('bozze');
    hook.unmount();
});

it('rejects business save when a later witness update fails but a previous witness still exists', async () => {
    const owner = storageOwner();
    await prepareUnlockedTestArchive(owner);
    const name = 'draft:measurement:2026-09-11';
    const dispatch = vi.fn().mockResolvedValue({ ok: true, status: 'synced' } as SyncResult);
    useAppStore.setState({ dispatchDomainOperation: dispatch });
    const hook = renderHook(() => useNutritionMeasurements('2026-09-11'));
    act(() => hook.result.current.setWeight('75'));
    const original = readDatedWriterEvidence(owner, name);
    expect(original.map(x => x.values.weight)).toEqual(['75']);

    const witnessPrefix = protectedDeviceKey('draft:dated-intent:', owner);
    const originalCiphertext = localStorage.getItem(protectedDeviceKey(original[0].name, owner));
    expect(originalCiphertext).toMatch(/^tlb-sealed:v1:/);
    vi.mocked(localStorage.setItem).mockImplementation((key, value) => {
        if (key.startsWith(witnessPrefix)) throw new DOMException('witness quota', 'QuotaExceededError');
        storeItem(key, value);
    });
    act(() => hook.result.current.setWeight('76'));
    expect(hook.result.current.weight).toBe('76');
    expect(readDatedWriterEvidence(owner, name)).toEqual(original);
    expect(localStorage.getItem(protectedDeviceKey(original[0].name, owner))).toBe(originalCiphertext);
    await act(async () => { await hook.result.current.calculateAndSave(); });
    expect(dispatch).not.toHaveBeenCalled();
    expect(readFencedDatedDraft(name, owner)?.weight).toBe('75');
    expect(localStorage.getItem(protectedDeviceKey(name, owner))).toMatch(/^tlb-sealed:v1:/);
    expect(localStorage.getItem(deviceKey(name, owner))).toBeNull();
    expect(() => draftRegistry.flushAll({ strict: true })).toThrow('bozze');
    hook.unmount();
});
});
