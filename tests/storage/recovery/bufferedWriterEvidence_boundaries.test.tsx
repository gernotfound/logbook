import { describe, expect, it, vi } from 'vitest';
import { setupBufferedWriterEvidence } from './bufferedWriterEvidenceFixture';
import { fireEvent } from '@testing-library/react';
import { deviceKey, protectedDeviceKey, readDeviceValueStrict, writeDeviceValue } from '../../../src/lib/sync/deviceStorage';
import { prepareUnlockedTestArchive } from '../../secureVaultFixture';
import { readBufferedDraftSnapshot } from '../../../src/lib/sync/bufferedDraftEpoch';
import { clearBufferedWriterIntent, createBufferedWriterIntentName, inspectBufferedRecoveryEvidence, readBufferedWriterEvidence, writeBufferedWriterIntent } from '../../../src/lib/sync/bufferedDraftWriterIntent';
import { captureSession } from '../../../src/lib/sync/session';
import { useAppStore } from '../../../src/store/useAppStore';

describe.each(['input', 'textarea'] as const)('Buffered writer evidence: provenance, limits and corrupted witnesses (%s)', kind => {
    const { workoutId, draftName, mount, edited } = setupBufferedWriterEvidence(kind);

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
