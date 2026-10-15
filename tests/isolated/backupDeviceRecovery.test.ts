import { beforeEach, describe, expect, it, vi } from 'vitest';
const storage = vi.hoisted(() => ({ drafts: new Map<string, string>(), read: vi.fn(), write: vi.fn(), flush: vi.fn() }));
vi.mock('../../src/lib/sync/deviceStorage', () => ({
    readDeviceValueStrict: storage.read,
    writeDeviceValue: storage.write,
}));
vi.mock('../../src/lib/utils/draftRegistry', () => ({ draftRegistry: { flushAll: storage.flush } }));
import { selectBackupDeviceDrafts, restoreMissingBackupDeviceDrafts } from '../../src/lib/backupDeviceRecovery';

beforeEach(() => {
    storage.drafts.clear();
    vi.clearAllMocks();
    storage.read.mockImplementation((name: string) => storage.drafts.get(name) ?? null);
    storage.write.mockImplementation((name: string, value: string) => { storage.drafts.set(name, value); });
});

describe('backup device draft recovery', () => {
    it('recovers absent drafts only, preserving newer drafts and excluding journal/workout/timer', () => {
        storage.drafts.set('draft_routine', '{"name":"newer"}');
        const drafts = selectBackupDeviceDrafts({ device: {
            draft_routine: '{"name":"old"}',
            'draft:measurement:2026-10-04': '{"weight":"80"}',
            'draft:buffered:input:note': 'private draft text',
            workout: '{"id":"unsynced"}',
            timer: '{"state":"running"}',
            'account-deletion': 'private receipt',
        } });
        expect(drafts.map(d => d.name)).toEqual(['draft_routine', 'draft:measurement:2026-10-04', 'draft:buffered:input:note']);
        const result = restoreMissingBackupDeviceDrafts(drafts, 'user:a', () => {});
        expect(result).toEqual({ restored: 2, preserved: 1 });
        expect(storage.drafts.get('draft_routine')).toBe('{"name":"newer"}');
        expect(storage.drafts.get('draft:measurement:2026-10-04')).toBe('{"weight":"80"}');
        expect(storage.write).toHaveBeenCalledWith('draft:measurement:2026-10-04', '{"weight":"80"}', 'user:a');
        expect(storage.flush).toHaveBeenCalledWith({ strict: true });
    });

    it('rejects malformed or oversized draft bytes before any write', () => {
        expect(() => selectBackupDeviceDrafts({ device: { draft_routine: '{' } })).toThrow('non JSON');
        expect(() => selectBackupDeviceDrafts({ device: { draft_exercise: '[]' } })).toThrow('struttura non valida');
        expect(() => selectBackupDeviceDrafts({ device: { draft_routine: 'x'.repeat(100_001) } })).toThrow('non valida');
        expect(storage.write).not.toHaveBeenCalled();
    });

    it('does not overwrite corrupt existing ciphertext or lose the error', () => {
        storage.read.mockImplementation(() => { throw new Error('invalid AEAD'); });
        const drafts = selectBackupDeviceDrafts({ device: { draft_routine: '{"name":"old"}' } });
        expect(() => restoreMissingBackupDeviceDrafts(drafts, 'user:a', () => {})).toThrow('invalid AEAD');
        expect(storage.write).not.toHaveBeenCalled();
    });

    it('never proceeds after owner/session changes or a failed draft flush', () => {
        const drafts = selectBackupDeviceDrafts({ device: { draft_routine: '{"name":"old"}' } });
        expect(() => restoreMissingBackupDeviceDrafts(drafts, 'user:a', () => { throw new Error('owner changed'); })).toThrow('owner changed');
        storage.flush.mockImplementationOnce(() => { throw new Error('buffered write failed'); });
        expect(() => restoreMissingBackupDeviceDrafts(drafts, 'user:a', () => {})).toThrow('buffered write failed');
        expect(storage.write).not.toHaveBeenCalled();
    });
});
