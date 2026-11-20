import { describe, expect, it, vi } from 'vitest';
import { setupBufferedWriterEvidence } from './bufferedWriterEvidenceFixture';
import React from 'react';
import { act, fireEvent } from '@testing-library/react';
import { BufferedWorkoutScope } from '../../../src/components/UI/bufferedWorkoutScope';
import { deviceKey, protectedDeviceKey } from '../../../src/lib/sync/deviceStorage';
import { prepareUnlockedTestArchive } from '../../secureVaultFixture';
import { readBufferedDraftSnapshot, writeBufferedDraft } from '../../../src/lib/sync/bufferedDraftEpoch';
import { createBufferedWriterIntentName, readBufferedWriterEvidence, writeBufferedWriterIntent } from '../../../src/lib/sync/bufferedDraftWriterIntent';
import { captureSession } from '../../../src/lib/sync/session';
import { requiredUpdateRecoveryRegistry } from '../../../src/lib/sync/requiredUpdateRecovery';
import { useAppStore } from '../../../src/store/useAppStore';
import { field } from './bufferedRecoveryFixtures';

describe.each(['input', 'textarea'] as const)('Buffered writer evidence: React remount, lineage and acknowledgement (%s)', kind => {
    const { workoutId, draftName, mount, edited } = setupBufferedWriterEvidence(kind);

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
});
