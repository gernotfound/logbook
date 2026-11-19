import React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, fireEvent, render } from '@testing-library/react';
import { BufferedWorkoutScope } from '../../../src/components/UI/bufferedWorkoutScope';
import type { WorkoutSession } from '../../../src/types';
import { deviceKey, protectedDeviceKey, readDeviceValueStrict, writeDeviceValue } from '../../../src/lib/sync/deviceStorage';
import { prepareUnlockedTestArchive } from '../../secureVaultFixture';
import { readBufferedDraftSnapshot, writeBufferedDraft } from '../../../src/lib/sync/bufferedDraftEpoch';
import { clearBufferedWriterIntent, createBufferedWriterIntentName, inspectBufferedRecoveryEvidence, readBufferedWriterEvidence, writeBufferedWriterIntent } from '../../../src/lib/sync/bufferedDraftWriterIntent';
import { captureSession } from '../../../src/lib/sync/session';
import { requiredUpdateRecoveryRegistry } from '../../../src/lib/sync/requiredUpdateRecovery';
import { useAppStore } from '../../../src/store/useAppStore';
import { localStorageMock } from '../../setup';
import { field, editor, initialGetItem, initialSetItem } from './bufferedRecoveryFixtures';

describe.each(['input', 'textarea'] as const)('independent same-workout %s writer evidence', kind => {
    const workoutId = 'same-workout';
    const draftName = `draft:buffered:${kind}:${workoutId}:stable-draft`;
    const mount = (update: (value: string) => void, value = '') => render(
        <BufferedWorkoutScope.Provider value={workoutId}>
            {field(kind, update, value)}
        </BufferedWorkoutScope.Provider>
    );
    const edited = (view: ReturnType<typeof render>) =>
        view.container.querySelector(kind === 'input' ? 'input' : 'textarea') as HTMLInputElement | HTMLTextAreaElement;

    beforeEach(() => {
        localStorageMock.getItem.mockImplementation(initialGetItem);
        localStorageMock.setItem.mockImplementation(initialSetItem);
        localStorage.clear();
        useAppStore.setState({
            localWorkout: { id: workoutId } as WorkoutSession,
            localPersistenceBlocked: false, syncHealth: 'synced',
            syncPresentation: 'normal', saveError: null,
        });
        const owner = captureSession().owner;
        localStorage.setItem(`logbook:v2:${owner}:health-consent-generation`, '3');
    });
    afterEach(() => {
        useAppStore.setState({ localWorkout: null });
        localStorageMock.getItem.mockImplementation(initialGetItem);
        localStorageMock.setItem.mockImplementation(initialSetItem);
        vi.restoreAllMocks();
    });

    it('quarantines unmarked encrypted account writer evidence even in consent epoch 1', async () => {
        const owner = captureSession().owner;
        expect(owner).toMatch(/^user:/);
        localStorage.setItem(deviceKey('health-consent-generation', owner), '1');
        await prepareUnlockedTestArchive(owner);
        const witness = createBufferedWriterIntentName();
        const raw = JSON.stringify({
            __logbookBufferedWriterIntent: 1, owner, draftName,
            value: 'Unverified previous input', revisionId: 'a'.repeat(32),
        });
        writeDeviceValue(witness, raw, owner);
        const sealedKey = protectedDeviceKey(witness, owner);
        const ciphertext = localStorage.getItem(sealedKey);
        expect(ciphertext).toMatch(/^tlb-sealed:v1:/);
        expect(localStorage.getItem(deviceKey(witness, owner))).toBeNull();

        expect(() => readBufferedWriterEvidence(owner, draftName))
            .toThrow('Testimonianza bufferizzata account senza revisione consenso');
        expect(() => writeBufferedWriterIntent(
            witness, owner, draftName, 'Unverified overwrite', raw, '1',
        )).toThrow('Testimonianza bufferizzata account senza revisione consenso');
        expect(() => clearBufferedWriterIntent(witness, owner, raw, '1'))
            .toThrow('Testimonianza bufferizzata account senza revisione consenso');

        // Field-specific recovery must not discard a valid unrelated witness.
        const unrelatedField = 'draft:buffered:' + kind + ':' + workoutId + ':different-field';
        const unrelatedWitness = createBufferedWriterIntentName();
        const written = writeBufferedWriterIntent(
            unrelatedWitness, owner, unrelatedField, 'Known valid input', null, '1',
        );
        expect(JSON.parse(written).consentRevision).toBe(1);
        expect(readBufferedWriterEvidence(owner, unrelatedField)).toHaveLength(1);
        const preview = inspectBufferedRecoveryEvidence(owner);
        expect(preview.find(entry => entry.name === witness)).toMatchObject({
            consentRevision: null, provenance: 'unknown', value: 'Unverified previous input',
        });
        expect(preview.find(entry => entry.name === unrelatedWitness)?.provenance).toBe('current');

        const report = vi.spyOn(console, 'error').mockImplementation(() => {});
        const view = mount(vi.fn(), 'Live input');
        expect(useAppStore.getState().localPersistenceBlocked).toBe(true);
        expect(report).toHaveBeenCalled();
        expect(localStorage.getItem(sealedKey)).toBe(ciphertext);
        expect(readDeviceValueStrict(witness, owner)).toBe(raw);
        expect(localStorage.getItem(protectedDeviceKey(draftName, owner))).toBeNull();
        view.unmount();
    });

    it('requires the account consent marker for fresh writer evidence and preserves valid epoch 1 writes', async () => {
        const owner = captureSession().owner;
        expect(owner).toMatch(/^user:/);
        await prepareUnlockedTestArchive(owner);
        const marker = deviceKey('health-consent-generation', owner);
        localStorage.removeItem(marker);
        const witness = createBufferedWriterIntentName();
        expect(() => writeBufferedWriterIntent(witness, owner, draftName, 'Unsafe edit', null))
            .toThrow('Generazione consenso testimonianza bufferizzata non verificabile');
        expect(localStorage.getItem(protectedDeviceKey(witness, owner))).toBeNull();
        expect(localStorage.getItem(deviceKey(witness, owner))).toBeNull();

        localStorage.setItem(marker, '1');
        const raw = writeBufferedWriterIntent(witness, owner, draftName, 'Verified edit', null, '1');
        expect(JSON.parse(raw)).toMatchObject({
            __logbookBufferedWriterIntent: 1, owner, draftName,
            consentRevision: 1, value: 'Verified edit',
        });
        expect(readBufferedWriterEvidence(owner, draftName).map(x => x.value)).toEqual(['Verified edit']);
        clearBufferedWriterIntent(witness, owner, raw, '1');
        expect(readBufferedWriterEvidence(owner, draftName)).toEqual([]);
    });

    it('retains both contenders even if a simultaneous shared overwrite loses one copy', async () => {
        const owner = captureSession().owner;
        await prepareUnlockedTestArchive(owner);
        const canonicalKey = protectedDeviceKey(draftName, owner);
        const a = createBufferedWriterIntentName();
        const b = createBufferedWriterIntentName();
        expect(a).not.toBe(b);
        writeBufferedWriterIntent(a, owner, draftName, 'Writer A private value', null, '3');
        writeBufferedWriterIntent(b, owner, draftName, 'Writer B private value', null, '3');

        // Deliberately force the shared-key lost-update outcome that localStorage
        // cannot prevent without CAS. Independent keys remain the evidence.
        writeBufferedDraft(draftName, owner, 'Writer A private value', '3');
        writeBufferedDraft(draftName, owner, 'Writer B private value', '3');
        expect(readBufferedDraftSnapshot(draftName, owner).value).toBe('Writer B private value');
        const names = [draftName, a, b];
        const ciphertexts = names.map(name => localStorage.getItem(protectedDeviceKey(name, owner)));
        expect(ciphertexts.every(raw => raw?.startsWith('tlb-sealed:v1:'))).toBe(true);
        names.forEach(name => expect(localStorage.getItem(deviceKey(name, owner))).toBeNull());
        expect(readBufferedWriterEvidence(owner, draftName).map(x => x.value).sort()).toEqual([
            'Writer A private value', 'Writer B private value',
        ]);

        const report = vi.spyOn(console, 'error').mockImplementation(() => {});
        const restore = mount(vi.fn(), 'new parent value');
        expect(edited(restore).value).toBe('new parent value');
        expect(useAppStore.getState().localPersistenceBlocked).toBe(true);
        expect(report).toHaveBeenCalled();
        expect(readBufferedWriterEvidence(owner, draftName)).toHaveLength(2);
        names.forEach((name, i) => expect(localStorage.getItem(protectedDeviceKey(name, owner))).toBe(ciphertexts[i]));
        expect(localStorage.getItem(canonicalKey)).toBe(ciphertexts[0]);
        restore.unmount();
    });

    it('never treats a private competing writer as absent when another tab compacts indexes', async () => {
        const owner = captureSession().owner;
        await prepareUnlockedTestArchive(owner);
        const unrelated = 'cross-tab:temporary-' + crypto.randomUUID();
        localStorage.setItem(unrelated, 'present');
        const a = createBufferedWriterIntentName();
        const b = createBufferedWriterIntentName();
        writeBufferedWriterIntent(a, owner, draftName, 'Writer A', null, '3');
        writeBufferedWriterIntent(b, owner, draftName, 'Writer B', null, '3');
        const aCipher = localStorage.getItem(protectedDeviceKey(a, owner));
        const bCipher = localStorage.getItem(protectedDeviceKey(b, owner));
        expect(aCipher).toMatch(/^tlb-sealed:v1:/);
        expect(bCipher).toMatch(/^tlb-sealed:v1:/);

        const originalKey = localStorageMock.key.getMockImplementation();
        if (!originalKey) throw new Error('Missing localStorage mock implementation');
        let compacted = false;
        localStorageMock.key.mockImplementation((index: number) => {
            const found = originalKey(index);
            if (!compacted && found === unrelated) {
                compacted = true;
                localStorage.removeItem(unrelated);
            }
            return found;
        });
        try {
            expect(() => readBufferedWriterEvidence(owner, draftName))
                .toThrow('Inventario copie bufferizzate');
        } finally {
            localStorageMock.key.mockImplementation(originalKey);
        }

        expect(compacted).toBe(true);
        expect(readBufferedWriterEvidence(owner, draftName).map(x => x.value).sort())
            .toEqual(['Writer A', 'Writer B']);
        expect(localStorage.getItem(protectedDeviceKey(a, owner))).toBe(aCipher);
        expect(localStorage.getItem(protectedDeviceKey(b, owner))).toBe(bCipher);
        expect(localStorage.getItem(deviceKey(a, owner))).toBeNull();
        expect(localStorage.getItem(deviceKey(b, owner))).toBeNull();
    });

    it('detects a competing writer added while authenticating the first witness', async () => {
        const owner = captureSession().owner;
        await prepareUnlockedTestArchive(owner);
        const first = createBufferedWriterIntentName();
        const second = createBufferedWriterIntentName();
        const original = writeBufferedWriterIntent(first, owner, draftName, 'Writer A', null, '3');
        const ciphertext = localStorage.getItem(protectedDeviceKey(first, owner));
        expect(ciphertext).toMatch(/^tlb-sealed:v1:/);
        const originalGet = localStorageMock.getItem.getMockImplementation();
        if (!originalGet) throw new Error('Missing browser storage mock implementation');
        let inserted = false;
        localStorageMock.getItem.mockImplementation((key: string) => {
            const value = originalGet(key);
            if (!inserted && key === protectedDeviceKey(first, owner)) {
                inserted = true;
                writeBufferedWriterIntent(second, owner, draftName, 'Writer B', null, '3');
            }
            return value;
        });
        try {
            expect(() => readBufferedWriterEvidence(owner, draftName))
                .toThrow('Copie bufferizzate o consenso cambiati');
        } finally {
            localStorageMock.getItem.mockImplementation(originalGet);
        }

        expect(inserted).toBe(true);
        expect(localStorage.getItem(protectedDeviceKey(first, owner))).toBe(ciphertext);
        expect(localStorage.getItem(protectedDeviceKey(second, owner))).toMatch(/^tlb-sealed:v1:/);
        expect(localStorage.getItem(deviceKey(first, owner))).toBeNull();
        expect(localStorage.getItem(deviceKey(second, owner))).toBeNull();
        expect(JSON.parse(original)).toMatchObject({ value: 'Writer A' });
        expect(readBufferedWriterEvidence(owner, draftName).map(x => x.value).sort())
            .toEqual(['Writer A', 'Writer B']);
        // Neither witness is removed or promoted into the business state.
    });

    it.each(['writer read', 'recovery inspector'] as const)(
        'rejects a consent change during the final buffered witness read (%s)', async mode => {
            const owner = captureSession().owner;
            await prepareUnlockedTestArchive(owner);
            expect(owner).toMatch(/^user:/);
            const marker = deviceKey('health-consent-generation', owner);
            const name = createBufferedWriterIntentName();
            const raw = writeBufferedWriterIntent(name, owner, draftName, 'Keep this private value', null, '3');
            const key = protectedDeviceKey(name, owner);
            const ciphertext = localStorage.getItem(key);
            expect(ciphertext).toMatch(/^tlb-sealed:v1:/);

            const originalGet = localStorageMock.getItem.getMockImplementation();
            if (!originalGet) throw new Error('Missing localStorage mock implementation');
            let reads = 0;
            localStorageMock.getItem.mockImplementation((readKey: string) => {
                const value = originalGet(readKey);
                if (readKey === key && ++reads === 2) {
                    localStorage.setItem(marker, '5');
                }
                return value;
            });
            try {
                expect(() => mode === 'writer read'
                    ? readBufferedWriterEvidence(owner, draftName)
                    : inspectBufferedRecoveryEvidence(owner)).toThrow('consenso cambiati');
            } finally {
                localStorageMock.getItem.mockImplementation(originalGet);
            }
            expect(reads).toBe(2);
            expect(localStorage.getItem(key)).toBe(ciphertext);
            expect(localStorage.getItem(deviceKey(name, owner))).toBeNull();
            expect(JSON.parse(raw)).toMatchObject({ value: 'Keep this private value' });
            expect(inspectBufferedRecoveryEvidence(owner)[0].provenance).toBe('previous');
        },
    );

    it('keeps a successfully written independent draft when canonical storage fails', async () => {
        const owner = captureSession().owner;
        await prepareUnlockedTestArchive(owner);
        const canonicalKey = protectedDeviceKey(draftName, owner);
        const report = vi.spyOn(console, 'error').mockImplementation(() => {});
        localStorageMock.setItem.mockImplementation((key: string, value: string) => {
            if (key === canonicalKey) throw new DOMException('quota exceeded', 'QuotaExceededError');
            return initialSetItem(key, value);
        });
        const view = mount(vi.fn());
        fireEvent.change(edited(view), { target: { value: 'Retained private edit' } });
        expect(localStorage.getItem(canonicalKey)).toBeNull();
        expect(localStorage.getItem(deviceKey(draftName, owner))).toBeNull();
        const [witness] = readBufferedWriterEvidence(owner, draftName);
        expect(witness.value).toBe('Retained private edit');
        const ciphertext = localStorage.getItem(protectedDeviceKey(witness.name, owner));
        expect(ciphertext).toMatch(/^tlb-sealed:v1:/);
        expect(localStorage.getItem(deviceKey(witness.name, owner))).toBeNull();
        expect(useAppStore.getState().localPersistenceBlocked).toBe(true);
        view.unmount();
        expect(report).toHaveBeenCalled();
    });

    it('restores one matching witness after a simulated reload and clears it only on parent acknowledgement', async () => {
        const owner = captureSession().owner;
        await prepareUnlockedTestArchive(owner);
        const sealedKey = protectedDeviceKey(draftName, owner);
        const value = 'Unsaved verified draft';
        const first = mount(vi.fn());
        fireEvent.change(edited(first), { target: { value } });
        const [witness] = readBufferedWriterEvidence(owner, draftName);
        expect(witness.value).toBe(value);
        const witnessCiphertext = localStorage.getItem(protectedDeviceKey(witness.name, owner));
        const sharedCiphertext = localStorage.getItem(sealedKey);
        expect(witnessCiphertext).toMatch(/^tlb-sealed:v1:/);
        expect(sharedCiphertext).toMatch(/^tlb-sealed:v1:/);
        expect(localStorage.getItem(deviceKey(witness.name, owner))).toBeNull();
        expect(localStorage.getItem(deviceKey(draftName, owner))).toBeNull();
        first.unmount();

        const update = vi.fn();
        const second = mount(update);
        expect(edited(second).value).toBe(value);
        expect(localStorage.getItem(protectedDeviceKey(witness.name, owner))).toBe(witnessCiphertext);
        expect(localStorage.getItem(sealedKey)).toBe(sharedCiphertext);
        expect(useAppStore.getState().localPersistenceBlocked).toBe(false);
        fireEvent.blur(edited(second));
        expect(update).toHaveBeenCalledExactlyOnceWith(value);
        second.rerender(
            <BufferedWorkoutScope.Provider value={workoutId}>
                {field(kind, update, value)}
            </BufferedWorkoutScope.Provider>,
        );
        expect(readBufferedDraftSnapshot(draftName, owner).raw).toBeNull();
        expect(readBufferedWriterEvidence(owner, draftName)).toHaveLength(0);
        expect(localStorage.getItem(sealedKey)).toBeNull();
        expect(localStorage.getItem(protectedDeviceKey(witness.name, owner))).toBeNull();
        expect(localStorage.getItem(deviceKey(draftName, owner))).toBeNull();
        second.unmount();
    });

    it('keeps a recovered buffered witness byte-for-byte unchanged on no-input required-update capture', async () => {
        const owner = captureSession().owner;
        await prepareUnlockedTestArchive(owner);
        const first = mount(vi.fn());
        fireEvent.change(edited(first), { target: { value: 'Recovery without new input' } });
        const previousEvidence = readBufferedWriterEvidence(owner, draftName);
        const sharedRaw = readBufferedDraftSnapshot(draftName, owner).raw;
        const encryptedCanonical = localStorage.getItem(protectedDeviceKey(draftName, owner));
        first.unmount();

        const reopened = mount(vi.fn());
        expect(edited(reopened).value).toBe('Recovery without new input');
        act(() => requiredUpdateRecoveryRegistry.captureAll());
        act(() => requiredUpdateRecoveryRegistry.captureAll());
        expect(readBufferedWriterEvidence(owner, draftName)).toEqual(previousEvidence);
        expect(readBufferedDraftSnapshot(draftName, owner).raw).toBe(sharedRaw);
        expect(localStorage.getItem(protectedDeviceKey(draftName, owner))).toBe(encryptedCanonical);

        fireEvent.change(edited(reopened), { target: { value: 'Real new input' } });
        const lineage = readBufferedWriterEvidence(owner, draftName);
        expect(lineage).toHaveLength(2);
        expect(lineage.at(-1)?.value).toBe('Real new input');
        reopened.unmount();
    });

    it('recovers a verified successor across successive React remounts and confirms its lineage', async () => {
        const owner = captureSession().owner;
        await prepareUnlockedTestArchive(owner);
        const sealedKey = protectedDeviceKey(draftName, owner);
        const first = mount(vi.fn());
        fireEvent.change(edited(first), { target: { value: '75' } });
        const [initialWitness] = readBufferedWriterEvidence(owner, draftName);
        expect(initialWitness.value).toBe('75');
        const initialCiphertext = localStorage.getItem(protectedDeviceKey(initialWitness.name, owner));
        expect(initialCiphertext).toMatch(/^tlb-sealed:v1:/);
        expect(localStorage.getItem(sealedKey)).toMatch(/^tlb-sealed:v1:/);
        first.unmount();

        const successor = mount(vi.fn());
        expect(edited(successor).value).toBe('75');
        fireEvent.change(edited(successor), { target: { value: '76' } });
        const lineage = readBufferedWriterEvidence(owner, draftName);
        expect(lineage).toHaveLength(2);
        const successorWitness = lineage.find(witness => witness.name !== initialWitness.name);
        expect(successorWitness?.value).toBe('76');
        expect(localStorage.getItem(protectedDeviceKey(successorWitness!.name, owner))).toMatch(/^tlb-sealed:v1:/);
        expect(localStorage.getItem(protectedDeviceKey(initialWitness.name, owner))).toBe(initialCiphertext);
        expect(localStorage.getItem(deviceKey(draftName, owner))).toBeNull();
        successor.unmount();

        const confirmed = vi.fn();
        const recovered = mount(confirmed);
        expect(edited(recovered).value).toBe('76');
        expect(useAppStore.getState().localPersistenceBlocked).toBe(false);
        fireEvent.blur(edited(recovered));
        recovered.rerender(
            <BufferedWorkoutScope.Provider value={workoutId}>
                {field(kind, confirmed, '76')}
            </BufferedWorkoutScope.Provider>,
        );
        expect(readBufferedDraftSnapshot(draftName, owner).raw).toBeNull();
        expect(readBufferedWriterEvidence(owner, draftName)).toHaveLength(0);
        expect(localStorage.getItem(sealedKey)).toBeNull();
        expect(localStorage.getItem(protectedDeviceKey(initialWitness.name, owner))).toBeNull();
        expect(localStorage.getItem(protectedDeviceKey(successorWitness!.name, owner))).toBeNull();
        expect(localStorage.getItem(deviceKey(draftName, owner))).toBeNull();
        recovered.unmount();
    });

    it('refuses sibling successors rather than declaring two editors one causal sequence', async () => {
        const owner = captureSession().owner;
        await prepareUnlockedTestArchive(owner);
        const root = createBufferedWriterIntentName();
        const first = writeBufferedWriterIntent(root, owner, draftName, 'original', null, '3');
        const nextA = createBufferedWriterIntentName();
        const nextB = createBufferedWriterIntentName();
        const parent = { name: root, revisionId: (JSON.parse(first) as { revisionId: string }).revisionId };
        writeBufferedWriterIntent(nextA, owner, draftName, 'A', null, '3', parent);
        writeBufferedWriterIntent(nextB, owner, draftName, 'B', null, '3', parent);
        writeBufferedDraft(draftName, owner, 'B', '3');
        const names = [root, nextA, nextB, draftName];
        const ciphertexts = names.map(name => localStorage.getItem(protectedDeviceKey(name, owner)));
        expect(ciphertexts.every(raw => raw?.startsWith('tlb-sealed:v1:'))).toBe(true);
        const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
        const view = mount(vi.fn());
        expect(useAppStore.getState().localPersistenceBlocked).toBe(true);
        expect(readBufferedWriterEvidence(owner, draftName)).toHaveLength(3);
        expect(readBufferedDraftSnapshot(draftName, owner).value).toBe('B');
        expect(spy).toHaveBeenCalled();
        names.forEach((name, i) => {
            expect(localStorage.getItem(protectedDeviceKey(name, owner))).toBe(ciphertexts[i]);
            expect(localStorage.getItem(deviceKey(name, owner))).toBeNull();
        });
        view.unmount();
    });

    it('rejects a successor whose predecessor was edited after the cited revision', async () => {
        const owner = captureSession().owner;
        await prepareUnlockedTestArchive(owner);
        const root = createBufferedWriterIntentName();
        const rootRaw = writeBufferedWriterIntent(root, owner, draftName, '75', null, '3');
        const parent = { name: root, revisionId: (JSON.parse(rootRaw) as { revisionId: string }).revisionId };
        const successor = createBufferedWriterIntentName();
        writeBufferedWriterIntent(successor, owner, draftName, '76', null, '3', parent);
        writeBufferedDraft(draftName, owner, '76', '3');

        // The still-live original writer changed the same independent key.
        writeBufferedWriterIntent(root, owner, draftName, '77', rootRaw, '3');
        const names = [root, successor, draftName];
        const ciphertexts = names.map(name => localStorage.getItem(protectedDeviceKey(name, owner)));
        expect(ciphertexts.every(raw => raw?.startsWith('tlb-sealed:v1:'))).toBe(true);
        const report = vi.spyOn(console, 'error').mockImplementation(() => {});
        const reopened = mount(vi.fn());
        expect(useAppStore.getState().localPersistenceBlocked).toBe(true);
        expect(readBufferedWriterEvidence(owner, draftName)).toHaveLength(2);
        expect(readBufferedDraftSnapshot(draftName, owner).value).toBe('76');
        expect(report).toHaveBeenCalled();
        names.forEach((name, i) => {
            expect(localStorage.getItem(protectedDeviceKey(name, owner))).toBe(ciphertexts[i]);
            expect(localStorage.getItem(deviceKey(name, owner))).toBeNull();
        });
        reopened.unmount();
    });

    it('reseals the live source editor when another acknowledged editor consumed its former witness', async () => {
        const owner = captureSession().owner;
        await prepareUnlockedTestArchive(owner);
        const sealedKey = protectedDeviceKey(draftName, owner);
        const source = mount(vi.fn());
        fireEvent.change(edited(source), { target: { value: '75' } });
        const [initial] = readBufferedWriterEvidence(owner, draftName);
        expect(initial.value).toBe('75');
        expect(localStorage.getItem(protectedDeviceKey(initial.name, owner))).toMatch(/^tlb-sealed:v1:/);
        expect(localStorage.getItem(deviceKey(initial.name, owner))).toBeNull();

        const confirm = vi.fn();
        const second = mount(confirm);
        expect(edited(second).value).toBe('75');
        fireEvent.change(edited(second), { target: { value: '76' } });
        fireEvent.blur(edited(second));
        expect(confirm).toHaveBeenCalledWith('76');
        second.rerender(
            <BufferedWorkoutScope.Provider value={workoutId}>
                {field(kind, confirm, '76')}
            </BufferedWorkoutScope.Provider>,
        );
        expect(readBufferedDraftSnapshot(draftName, owner).raw).toBeNull();
        expect(readBufferedWriterEvidence(owner, draftName)).toHaveLength(0);
        expect(localStorage.getItem(sealedKey)).toBeNull();
        expect(localStorage.getItem(protectedDeviceKey(initial.name, owner))).toBeNull();

        // The old field is still mounted. Its next keystroke cannot reuse
        // the consumed slot, and cannot overwrite the acknowledged canonical.
        const report = vi.spyOn(console, 'error').mockImplementation(() => {});
        fireEvent.change(edited(source), { target: { value: '77' } });
        const [next] = readBufferedWriterEvidence(owner, draftName);
        expect(next.name).not.toBe(initial.name);
        expect(next.value).toBe('77');
        expect(localStorage.getItem(protectedDeviceKey(next.name, owner))).toMatch(/^tlb-sealed:v1:/);
        expect(localStorage.getItem(deviceKey(next.name, owner))).toBeNull();
        expect(readBufferedDraftSnapshot(draftName, owner).raw).toBeNull();
        expect(localStorage.getItem(sealedKey)).toBeNull();
        expect(useAppStore.getState().localPersistenceBlocked).toBe(true);
        expect(report).toHaveBeenCalled();
        second.unmount();
        source.unmount();
    });

    it('does not block an unrelated field because an older-consent witness still exists', async () => {
        const owner = captureSession().owner;
        await prepareUnlockedTestArchive(owner);
        const marker = `logbook:v2:${owner}:health-consent-generation`;
        const oldField = `draft:buffered:${kind}:${workoutId}:historical-field`;
        const historicalName = createBufferedWriterIntentName();
        localStorage.setItem(marker, '2');
        const historicalRaw = writeBufferedWriterIntent(
            historicalName, owner, oldField, 'private historical value', null, '2',
        );
        const oldCiphertext = localStorage.getItem(protectedDeviceKey(historicalName, owner));
        expect(oldCiphertext).toMatch(/^tlb-sealed:v1:/);
        localStorage.setItem(marker, '3');

        expect(readBufferedWriterEvidence(owner, draftName)).toEqual([]);
        const update = vi.fn();
        const view = mount(update);
        expect(useAppStore.getState().localPersistenceBlocked).toBe(false);
        fireEvent.change(edited(view), { target: { value: 'Current field' } });
        fireEvent.blur(edited(view));
        expect(update).toHaveBeenCalledWith('Current field');
        expect(useAppStore.getState().localPersistenceBlocked).toBe(false);
        expect(localStorage.getItem(protectedDeviceKey(historicalName, owner))).toBe(oldCiphertext);
        expect(localStorage.getItem(deviceKey(historicalName, owner))).toBeNull();
        expect(JSON.parse(historicalRaw)).toMatchObject({ value: 'private historical value', consentRevision: 2 });
        expect(localStorage.getItem(protectedDeviceKey(draftName, owner))).toMatch(/^tlb-sealed:v1:/);
        expect(localStorage.getItem(deviceKey(draftName, owner))).toBeNull();
        view.unmount();
    });

    it('counts the 64-witness guard per field, not across unrelated fields', async () => {
        const owner = captureSession().owner;
        await prepareUnlockedTestArchive(owner);
        const unrelated: string[] = [];
        for (let index = 0; index < 65; index++) {
            const name = createBufferedWriterIntentName();
            unrelated.push(name);
            writeBufferedWriterIntent(
                name, owner,
                `draft:buffered:${kind}:${workoutId}:other-${index}`,
                `Historical note ${index}`, null, '3',
            );
        }
        expect(readBufferedWriterEvidence(owner, draftName)).toEqual([]);
        expect(unrelated).toHaveLength(65);
        for (const name of unrelated) {
            expect(localStorage.getItem(protectedDeviceKey(name, owner))).toMatch(/^tlb-sealed:v1:/);
            expect(localStorage.getItem(deviceKey(name, owner))).toBeNull();
        }
        const view = mount(vi.fn());
        expect(useAppStore.getState().localPersistenceBlocked).toBe(false);
        fireEvent.change(edited(view), { target: { value: 'New private value' } });
        expect(useAppStore.getState().localPersistenceBlocked).toBe(false);
        expect(readBufferedDraftSnapshot(draftName, owner).value).toBe('New private value');
        expect(localStorage.getItem(protectedDeviceKey(draftName, owner))).toMatch(/^tlb-sealed:v1:/);
        expect(localStorage.getItem(deviceKey(draftName, owner))).toBeNull();
        view.unmount();
    });

    it('does not hide malformed unrelated witnesses whose source field cannot be verified', () => {
        const owner = captureSession().owner;
        const name = createBufferedWriterIntentName();
        localStorage.setItem(deviceKey(name, owner), JSON.stringify({
            __logbookBufferedWriterIntent: 1,
            owner, draftName: 7, value: 'unknown provenance', consentRevision: 2,
        }));
        expect(() => readBufferedWriterEvidence(owner, draftName)).toThrow();
    });

    it('lists multiple independent copies without replaying, clearing or replacing any bytes', async () => {
        const owner = captureSession().owner;
        await prepareUnlockedTestArchive(owner);
        const nameA = createBufferedWriterIntentName();
        const nameB = createBufferedWriterIntentName();
        const a = writeBufferedWriterIntent(nameA, owner, draftName, 'Private value A', null, '3');
        const b = writeBufferedWriterIntent(nameB, owner, draftName, 'Private value B', null, '3');
        const cipherA = localStorage.getItem(protectedDeviceKey(nameA, owner));
        const cipherB = localStorage.getItem(protectedDeviceKey(nameB, owner));
        expect(cipherA).toMatch(/^tlb-sealed:v1:/);
        expect(cipherB).toMatch(/^tlb-sealed:v1:/);
        const result = inspectBufferedRecoveryEvidence(owner);
        expect(result.map(x => x.value).sort()).toEqual(['Private value A', 'Private value B']);
        expect(result.every(x => x.draftName === draftName)).toBe(true);
        expect(localStorage.getItem(protectedDeviceKey(nameA, owner))).toBe(cipherA);
        expect(localStorage.getItem(protectedDeviceKey(nameB, owner))).toBe(cipherB);
        expect(localStorage.getItem(deviceKey(nameA, owner))).toBeNull();
        expect(localStorage.getItem(deviceKey(nameB, owner))).toBeNull();
        expect(JSON.parse(a)).toMatchObject({ value: 'Private value A' });
        expect(JSON.parse(b)).toMatchObject({ value: 'Private value B' });
        expect(localStorage.getItem(protectedDeviceKey(draftName, owner))).toBeNull();
        expect(readBufferedWriterEvidence(owner, draftName)).toHaveLength(2);
    });

    it('keeps historical revisions visible but never re-labels them as current', async () => {
        const owner = captureSession().owner;
        await prepareUnlockedTestArchive(owner);
        const marker = `logbook:v2:${owner}:health-consent-generation`;
        const previous = createBufferedWriterIntentName();
        localStorage.setItem(marker, '2');
        const before = writeBufferedWriterIntent(previous, owner, draftName, 'Historical note', null, '2');
        localStorage.setItem(marker, '3');
        const previousCiphertext = localStorage.getItem(protectedDeviceKey(previous, owner));
        expect(previousCiphertext).toMatch(/^tlb-sealed:v1:/);
        const current = createBufferedWriterIntentName();
        writeBufferedWriterIntent(current, owner, draftName, 'Current note', null, '3');
        const result = inspectBufferedRecoveryEvidence(owner);
        expect(result).toHaveLength(2);
        if (owner.startsWith('user:')) {
            expect(result.map(x => x.provenance).sort()).toEqual(['current', 'previous']);
        } else {
            expect(result.map(x => x.provenance)).toEqual(['guest', 'guest']);
        }
        expect(result.find(x => x.name === previous)?.value).toBe('Historical note');
        expect(localStorage.getItem(protectedDeviceKey(previous, owner))).toBe(previousCiphertext);
        expect(localStorage.getItem(protectedDeviceKey(current, owner))).toMatch(/^tlb-sealed:v1:/);
        expect(localStorage.getItem(deviceKey(previous, owner))).toBeNull();
        expect(localStorage.getItem(deviceKey(current, owner))).toBeNull();
        expect(JSON.parse(before)).toMatchObject({ value: 'Historical note', consentRevision: 2 });
    });

    it('rejects malformed independent witness identities without selecting or deleting the copy', async () => {
        await prepareUnlockedTestArchive(captureSession().owner);
        const owner = captureSession().owner;
        const invalidName = 'draft:buffered-intent:not-a-random-id';
        const key = protectedDeviceKey(invalidName, owner);
        const raw = JSON.stringify({
            __logbookBufferedWriterIntent: 1, owner, draftName,
            value: 'Unconfirmed health data', consentRevision: 3,
        });
        writeDeviceValue(invalidName, raw, owner);
        const originalCiphertext = localStorage.getItem(key);
        expect(() => readBufferedWriterEvidence(owner, draftName))
            .toThrow('Metadati intenzione bozza non validi');
        expect(() => inspectBufferedRecoveryEvidence(owner))
            .toThrow('Metadati intenzione bozza non validi');
        expect(localStorage.getItem(key)).toBe(originalCiphertext);
    });

    it('rejects write and cleanup of a malformed witness key without changing its contents', () => {
        const owner = captureSession().owner;
        const invalidName = 'draft:buffered-intent:not-a-random-id';
        const key = deviceKey(invalidName, owner);
        const raw = JSON.stringify({
            __logbookBufferedWriterIntent: 1, owner, draftName,
            value: 'Private original', consentRevision: 3,
        });
        localStorage.setItem(key, raw);
        expect(() => writeBufferedWriterIntent(
            invalidName, owner, draftName, 'New value', raw, '3',
        )).toThrow('Identità intenzione bozza non valida');
        expect(() => clearBufferedWriterIntent(invalidName, owner, raw, '3'))
            .toThrow('Identità intenzione bozza non valida');
        expect(localStorage.getItem(key)).toBe(raw);
    });

    it('fails closed on corrupted evidence and keeps every original intact', async () => {
        await prepareUnlockedTestArchive(captureSession().owner);
        const owner = captureSession().owner;
        const valid = createBufferedWriterIntentName();
        const broken = createBufferedWriterIntentName();
        const raw = writeBufferedWriterIntent(valid, owner, draftName, 'Kept intact', null, '3');
        writeDeviceValue(broken, 'not-json', owner);
        const brokenKey = protectedDeviceKey(broken, owner);
        const brokenCiphertext = localStorage.getItem(brokenKey);
        const originalCiphertext = localStorage.getItem(protectedDeviceKey(valid, owner));
        expect(() => inspectBufferedRecoveryEvidence(owner)).toThrow();
        expect(readDeviceValueStrict(valid, owner)).toBe(raw);
        expect(localStorage.getItem(protectedDeviceKey(valid, owner))).toBe(originalCiphertext);
        expect(localStorage.getItem(brokenKey)).toBe(brokenCiphertext);
    });

    it('never clears a changed writer slot with a stale acknowledgement', async () => {
        await prepareUnlockedTestArchive(captureSession().owner);
        const owner = captureSession().owner;
        const name = createBufferedWriterIntentName();
        const raw = writeBufferedWriterIntent(name, owner, draftName, 'version 1', null, '3');
        const newer = writeBufferedWriterIntent(name, owner, draftName, 'version 2', raw, '3');
        expect(() => clearBufferedWriterIntent(name, owner, raw, '3')).toThrow();
        expect(readBufferedWriterEvidence(owner, draftName)).toMatchObject([
            { name, raw: newer, value: 'version 2' },
        ]);
    });
});
