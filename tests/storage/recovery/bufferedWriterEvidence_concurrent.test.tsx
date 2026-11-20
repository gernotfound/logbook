import { describe, expect, it, vi } from 'vitest';
import { setupBufferedWriterEvidence } from './bufferedWriterEvidenceFixture';
import { fireEvent } from '@testing-library/react';
import { deviceKey, protectedDeviceKey, readDeviceValueStrict, writeDeviceValue } from '../../../src/lib/sync/deviceStorage';
import { prepareUnlockedTestArchive } from '../../secureVaultFixture';
import { readBufferedDraftSnapshot, writeBufferedDraft } from '../../../src/lib/sync/bufferedDraftEpoch';
import { clearBufferedWriterIntent, createBufferedWriterIntentName, inspectBufferedRecoveryEvidence, readBufferedWriterEvidence, writeBufferedWriterIntent } from '../../../src/lib/sync/bufferedDraftWriterIntent';
import { captureSession } from '../../../src/lib/sync/session';
import { useAppStore } from '../../../src/store/useAppStore';
import { localStorageMock } from '../../setup';
import { initialSetItem } from './bufferedRecoveryFixtures';

describe.each(['input', 'textarea'] as const)('Buffered writer evidence: independent ciphertext and concurrent writes (%s)', kind => {
    const { workoutId, draftName, mount, edited } = setupBufferedWriterEvidence(kind);

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
});
