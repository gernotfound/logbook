import { act, renderHook } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { useNutritionMeasurements } from '../../../src/hooks/useNutritionMeasurements';
import { useAppStore } from '../../../src/store/useAppStore';
import { invalidateSession, storageOwner } from '../../../src/lib/sync/session';
import { deviceKey, protectedDeviceKey, writeDeviceValue } from '../../../src/lib/sync/deviceStorage';
import { prepareUnlockedTestArchive } from '../../secureVaultFixture';
import { DatedDraftConflictError, readFencedDatedDraft, readFencedDatedDraftImage, writeFencedDatedDraft, UnverifiedDatedDraftEpochError } from '../../../src/lib/sync/datedDraftEpoch';
import { readDatedWriterEvidence } from '../../../src/lib/sync/datedDraftWriterIntent';
import { mockFirebaseAuth } from '../../setup';
import { requireHealthConsentWritable } from '../../../src/lib/healthConsent';
import { installDatedDraftFixtures, data } from './datedDraftFixtures';

installDatedDraftFixtures();

describe('Owner, consent revision and dated-draft fencing', () => {
it('uses the fenced store owner without rereading lifecycle ownership on rerender', () => {
    const getItem = vi.spyOn(localStorage, 'getItem');
    const hook = renderHook(() => useNutritionMeasurements('2026-09-11'));
    getItem.mockClear();

    hook.rerender();

    const lifecycleKeys = new Set(['logbook_is_guest', 'logbook_authenticated_owner']);
    expect(getItem.mock.calls.some(([key]) => lifecycleKeys.has(String(key)))).toBe(false);
});

it('fails closed instead of inferring an owner when userData is not owner-fenced', () => {
    const owner = storageOwner();
    useAppStore.setState({ dataOwner: null });
    const hook = renderHook(() => useNutritionMeasurements('2026-09-11'));
    act(() => hook.result.current.setWeight('75'));
    expect(hook.result.current.weight).toBe('');
    expect(localStorage.getItem(deviceKey('draft:measurement:2026-09-11', owner))).toBeNull();
});

it('never bypasses the health-consent write gate when persisting a dated draft', async () => {
    await prepareUnlockedTestArchive(storageOwner());
    vi.mocked(requireHealthConsentWritable).mockImplementationOnce(() => {
        throw new Error('Consent suspended');
    });
    const hook = renderHook(() => useNutritionMeasurements('2026-09-11'));
    act(() => hook.result.current.setWeight('75'));
    expect(hook.result.current.weight).toBe('75');
    expect(localStorage.getItem(deviceKey('draft:measurement:2026-09-11', storageOwner()))).toBeNull();
    expect(useAppStore.getState().saveError).toContain('solo in memoria');
});

it('quarantines an old measurement draft after reacceptance instead of restaging erased data', () => {
    localStorage.removeItem('logbook_is_guest');
    invalidateSession();
    const owner = 'user:' + mockFirebaseAuth.currentUser!.uid;
    const key = deviceKey('draft:measurement:2026-09-11', owner);
    localStorage.setItem(`logbook:v2:${owner}:health-consent-generation`, '1');
    const original = JSON.stringify({ __logbookDatedDraft: 2, owner, revisionId: 'a'.repeat(32), consentRevision: 1, values: { weight: '75', waist: '80' } });
    localStorage.setItem(key, original);
    localStorage.setItem(`logbook:v2:${owner}:health-consent-generation`, '3');
    useAppStore.setState({ userData: data(), dataOwner: owner, localPersistenceBlocked: false });

    const hook = renderHook(() => useNutritionMeasurements('2026-09-11'));
    expect(hook.result.current.weight).toBe('');
    expect(hook.result.current.waist).toBe('');
    expect(useAppStore.getState().localPersistenceBlocked).toBe(true);
    expect(useAppStore.getState().saveError).toContain('cifrato');
    act(() => hook.result.current.setWeight('90'));
    expect(hook.result.current.weight).toBe('');
    expect(readDatedWriterEvidence(owner, 'draft:measurement:2026-09-11')).toHaveLength(0);
    expect(localStorage.getItem(key)).toBe(original);
    expect(() => writeFencedDatedDraft('draft:measurement:2026-09-11', owner, null))
        .toThrow('Archivio locale cifrato non valido');
    expect(() => writeFencedDatedDraft('draft:measurement:2026-09-11', owner, { weight: '90' }))
        .toThrow('Archivio locale cifrato non valido');
    expect(localStorage.getItem(key)).toBe(original);
});

it('prevents a mounted old form from publishing stale health data after a cross-tab epoch change', async () => {
    localStorage.removeItem('logbook_is_guest');
    invalidateSession();
    const owner = 'user:' + mockFirebaseAuth.currentUser!.uid;
    const name = 'draft:measurement:2026-09-11';
    const key = protectedDeviceKey(name, owner);
    const marker = `logbook:v2:${owner}:health-consent-generation`;
    localStorage.setItem(marker, '1');
    await prepareUnlockedTestArchive(owner);
    writeFencedDatedDraft(name, owner, { weight: '75' });
    const original = localStorage.getItem(key);
    useAppStore.setState({ userData: data(), dataOwner: owner, localPersistenceBlocked: false });
    const beforeData = useAppStore.getState().userData;
    const hook = renderHook(() => useNutritionMeasurements('2026-09-11'));
    expect(hook.result.current.weight).toBe('75');

    // No rerender yet: a stale UI event handler still holds the old field values.
    localStorage.setItem(marker, '3');
    await act(async () => { await hook.result.current.calculateAndSave(); });
    expect(useAppStore.getState().userData).toEqual(beforeData);
    expect(localStorage.getItem(key)).toBe(original);

    hook.rerender();
    expect(hook.result.current.weight).toBe('');
    expect(useAppStore.getState().localPersistenceBlocked).toBe(true);
    act(() => hook.result.current.setWeight('80'));
    expect(localStorage.getItem(key)).toBe(original);
});

it('stamps a new measurement draft and fences it after the generation changes', async () => {
    localStorage.removeItem('logbook_is_guest');
    invalidateSession();
    const owner = 'user:' + mockFirebaseAuth.currentUser!.uid;
    const name = 'draft:measurement:2026-09-11';
    const key = deviceKey(name, owner);
    const sealedKey = protectedDeviceKey(name, owner);
    const marker = `logbook:v2:${owner}:health-consent-generation`;
    localStorage.setItem(marker, '3');
    await prepareUnlockedTestArchive(owner);
    useAppStore.setState({ userData: data(), dataOwner: owner, localPersistenceBlocked: false });
    const hook = renderHook(() => useNutritionMeasurements('2026-09-11'));
    act(() => hook.result.current.setWeight('77'));
    const raw = readFencedDatedDraftImage(name, owner).raw;
    const ciphertext = localStorage.getItem(sealedKey);
    expect(ciphertext).toMatch(/^tlb-sealed:v1:/);
    expect(localStorage.getItem(key)).toBeNull();
    expect(JSON.parse(raw!)).toMatchObject({
        __logbookDatedDraft: 2, owner, consentRevision: 3, values: { weight: '77' },
    });
    expect(readFencedDatedDraft(name, owner)?.weight).toBe('77');
    hook.unmount();
    localStorage.setItem(marker, '5');
    expect(() => readFencedDatedDraft(name, owner))
        .toThrow(UnverifiedDatedDraftEpochError);
    expect(localStorage.getItem(sealedKey)).toBe(ciphertext);
    expect(localStorage.getItem(key)).toBeNull();
});

it('rejects altered owner and revision in a stamped draft without replacing it', async () => {
    await prepareUnlockedTestArchive('user:' + mockFirebaseAuth.currentUser!.uid);
    const owner = 'user:' + mockFirebaseAuth.currentUser!.uid;
    const name = 'draft:measurement:2026-09-11';
    const key = protectedDeviceKey(name, owner);
    localStorage.setItem(`logbook:v2:${owner}:health-consent-generation`, '3');
    const original = JSON.stringify({
        __logbookDatedDraft: 2, owner: 'user:foreign', revisionId: 'c'.repeat(32), consentRevision: 3,
        values: { weight: '80' },
    });
    writeDeviceValue(name, original, owner);
    const originalCiphertext = localStorage.getItem(key);
    expect(() => readFencedDatedDraft('draft:measurement:2026-09-11', owner))
        .toThrow('Provenienza della bozza locale non valida');
    expect(() => writeFencedDatedDraft('draft:measurement:2026-09-11', owner, { weight: '81' }))
        .toThrow('Provenienza della bozza locale non valida');
    expect(localStorage.getItem(key)).toBe(originalCiphertext);
});

it('quarantines unmarked account V2 drafts and tombstones even at consent epoch 1', async () => {
    localStorage.removeItem('logbook_is_guest');
    invalidateSession();
    const owner = 'user:' + mockFirebaseAuth.currentUser!.uid;
    const marker = `logbook:v2:${owner}:health-consent-generation`;
    const name = 'draft:measurement:2026-09-11';
    localStorage.setItem(marker, '1');
    await prepareUnlockedTestArchive(owner);
    const sealedKey = protectedDeviceKey(name, owner);

    for (const values of [{ weight: '75' }, null]) {
        // The underlying sealed storage accepts bytes; the domain boundary
        // must reject an old record without attested provenance.
        writeDeviceValue(name, JSON.stringify({
            __logbookDatedDraft: 2, owner, revisionId: 'a'.repeat(32), values,
        }), owner);
        const original = localStorage.getItem(sealedKey);
        expect(original).toMatch(/^tlb-sealed:v1:/);
        expect(() => readFencedDatedDraftImage(name, owner))
            .toThrow('Provenienza della bozza locale non valida');
        expect(() => writeFencedDatedDraft(name, owner, { weight: '80' }))
            .toThrow('Provenienza della bozza locale non valida');
        expect(() => writeFencedDatedDraft(name, owner, null))
            .toThrow('Provenienza della bozza locale non valida');
        expect(localStorage.getItem(sealedKey)).toBe(original);
        expect(localStorage.getItem(deviceKey(name, owner))).toBeNull();
    }
});

it('refuses new account drafts or tombstones without a consent epoch, but allows the current stamped format', async () => {
    localStorage.removeItem('logbook_is_guest');
    invalidateSession();
    const owner = 'user:' + mockFirebaseAuth.currentUser!.uid;
    const marker = `logbook:v2:${owner}:health-consent-generation`;
    const name = 'draft:sleep:2026-09-11';
    localStorage.removeItem(marker);
    await prepareUnlockedTestArchive(owner);
    for (const values of [{ sleepHours: '08:00' }, null]) {
        expect(() => writeFencedDatedDraft(name, owner, values))
            .toThrow(UnverifiedDatedDraftEpochError);
        expect(localStorage.getItem(protectedDeviceKey(name, owner))).toBeNull();
    }
    localStorage.setItem(marker, '1');
    const stamped = writeFencedDatedDraft(name, owner, { sleepHours: '08:00' });
    expect(JSON.parse(stamped)).toMatchObject({
        __logbookDatedDraft: 2, owner, consentRevision: 1, values: { sleepHours: '08:00' },
    });
    const tombstone = writeFencedDatedDraft(name, owner, null, stamped);
    expect(JSON.parse(tombstone)).toMatchObject({
        __logbookDatedDraft: 2, owner, consentRevision: 1, values: null,
    });
    expect(readFencedDatedDraftImage(name, owner)).toEqual({ values: null, raw: tombstone });
});

it('preserves unsupported pre-launch V1 and unwrapped drafts without reading or replacing them', () => {
    const owner = storageOwner();
    const name = 'draft:measurement:2026-09-11';
    const key = deviceKey(name, owner);
    for (const original of [
        JSON.stringify({ __logbookDatedDraft: 1, owner, consentRevision: 1, values: { weight: '70' } }),
        JSON.stringify({ weight: '70' }),
    ]) {
        localStorage.setItem(key, original);
        expect(() => readFencedDatedDraft(name, owner)).toThrow('Archivio locale cifrato non valido');
        expect(() => writeFencedDatedDraft(name, owner, { weight: '71' }))
            .toThrow('Archivio locale cifrato non valido');
        expect(localStorage.getItem(key)).toBe(original);
    }
});

it('rejects stale replacement and cleanup of a dated draft in the same consent generation', async () => {
    const owner = storageOwner();
    const name = 'draft:sleep:2026-09-11';
    await prepareUnlockedTestArchive(owner);
    const sealedKey = protectedDeviceKey(name, owner);
    const first = writeFencedDatedDraft(name, owner, { sleepHours: '08:00', sleepDeep: '02:00' }, null);
    const firstCiphertext = localStorage.getItem(sealedKey);
    expect(firstCiphertext).toMatch(/^tlb-sealed:v1:/);
    expect(localStorage.getItem(deviceKey(name, owner))).toBeNull();
    expect(readFencedDatedDraftImage(name, owner).raw).toBe(first);
    const second = writeFencedDatedDraft(name, owner, { sleepHours: '07:30', sleepDeep: '01:45' }, first);
    expect(second).not.toBe(first);
    const secondCiphertext = localStorage.getItem(sealedKey);
    expect(secondCiphertext).toMatch(/^tlb-sealed:v1:/);
    expect(secondCiphertext).not.toBe(firstCiphertext);

    expect(() => writeFencedDatedDraft(name, owner, { sleepHours: '06:00' }, first))
        .toThrow(DatedDraftConflictError);
    expect(() => writeFencedDatedDraft(name, owner, null, first))
        .toThrow(DatedDraftConflictError);
    expect(readFencedDatedDraftImage(name, owner)).toEqual({
        values: { sleepHours: '07:30', sleepDeep: '01:45' }, raw: second,
    });
    expect(localStorage.getItem(sealedKey)).toBe(secondCiphertext);
    expect(localStorage.getItem(deviceKey(name, owner))).toBeNull();
});

it('prevents an absent → written → cleared ABA cycle from authorizing a stale form', async () => {
    const owner = storageOwner();
    const name = 'draft:sleep:2026-09-11';
    await prepareUnlockedTestArchive(owner);
    const sealedKey = protectedDeviceKey(name, owner);
    const staleRaw = readFencedDatedDraftImage(name, owner).raw;
    expect(staleRaw).toBeNull();
    const saved = writeFencedDatedDraft(name, owner, { sleepHours: '08:00' }, staleRaw);
    const cleared = writeFencedDatedDraft(name, owner, null, saved);
    const after = readFencedDatedDraftImage(name, owner);
    expect(after.values).toBeNull();
    expect(after.raw).toBe(cleared);
    expect(cleared).not.toBe(staleRaw);
    expect(() => writeFencedDatedDraft(name, owner, { sleepHours: '06:00' }, staleRaw))
        .toThrow(DatedDraftConflictError);
    expect(() => writeFencedDatedDraft(name, owner, null, staleRaw))
        .toThrow(DatedDraftConflictError);
    expect(readFencedDatedDraftImage(name, owner)).toEqual(after);
    expect(localStorage.getItem(sealedKey)).toMatch(/^tlb-sealed:v1:/);
    expect(localStorage.getItem(deviceKey(name, owner))).toBeNull();
});

it('uses a new revision even when identical values are written again', async () => {
    const owner = storageOwner();
    const name = 'draft:measurement:2026-09-11';
    await prepareUnlockedTestArchive(owner);
    const sealedKey = protectedDeviceKey(name, owner);
    const first = writeFencedDatedDraft(name, owner, { weight: '75' }, null);
    const second = writeFencedDatedDraft(name, owner, { weight: '75' }, first);
    expect(second).not.toBe(first);
    expect(() => writeFencedDatedDraft(name, owner, { weight: '76' }, first))
        .toThrow(DatedDraftConflictError);
    expect(readFencedDatedDraft(name, owner)).toEqual({ weight: '75' });
    expect(localStorage.getItem(sealedKey)).toMatch(/^tlb-sealed:v1:/);
    expect(localStorage.getItem(deviceKey(name, owner))).toBeNull();
});

it('permits a new consent generation to replace a previous-generation deletion marker, not old data', async () => {
    localStorage.removeItem('logbook_is_guest');
    invalidateSession();
    const owner = 'user:' + mockFirebaseAuth.currentUser!.uid;
    const marker = `logbook:v2:${owner}:health-consent-generation`;
    const name = 'draft:measurement:2026-09-11';
    localStorage.setItem(marker, '3');
    await prepareUnlockedTestArchive(owner);
    const sealedKey = protectedDeviceKey(name, owner);
    const initial = writeFencedDatedDraft(name, owner, { weight: '76' }, null);
    const tombstone = writeFencedDatedDraft(name, owner, null, initial);
    const tombstoneCiphertext = localStorage.getItem(sealedKey);
    expect(tombstoneCiphertext).toMatch(/^tlb-sealed:v1:/);
    localStorage.setItem(marker, '5');
    expect(readFencedDatedDraftImage(name, owner)).toEqual({ values: null, raw: tombstone });
    const next = writeFencedDatedDraft(name, owner, { weight: '77' }, tombstone);
    expect(JSON.parse(next)).toMatchObject({
        __logbookDatedDraft: 2, owner, consentRevision: 5, values: { weight: '77' },
    });
    expect(readFencedDatedDraft(name, owner)).toEqual({ weight: '77' });
    expect(localStorage.getItem(sealedKey)).toMatch(/^tlb-sealed:v1:/);
    expect(localStorage.getItem(sealedKey)).not.toBe(tombstoneCiphertext);
    expect(localStorage.getItem(deviceKey(name, owner))).toBeNull();
});

it('refuses malformed deletion-marker revisions without rewriting the original bytes', async () => {
    await prepareUnlockedTestArchive(storageOwner());
    const owner = storageOwner();
    const name = 'draft:sleep:2026-09-11';
    const key = protectedDeviceKey(name, owner);
    const tampered = JSON.stringify({
        __logbookDatedDraft: 2, owner, revisionId: 'not-random', values: null,
    });
    writeDeviceValue(name, tampered, owner);
    const originalCiphertext = localStorage.getItem(key);
    expect(() => readFencedDatedDraftImage(name, owner)).toThrow('Provenienza');
    expect(() => writeFencedDatedDraft(name, owner, { sleepHours: '08:00' }))
        .toThrow('Provenienza');
    expect(localStorage.getItem(key)).toBe(originalCiphertext);
});
});
