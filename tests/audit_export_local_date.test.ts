import { afterEach, describe, expect, it, vi } from 'vitest';
import { Exporter } from '../src/lib/export';
import { Logic } from '../src/lib/logic';
import { useAppStore } from '../src/store/useAppStore';
import { CURRENT_BACKUP_SCHEMA, CURRENT_DATA_SCHEMA, CURRENT_SYNC_PROTOCOL } from '../src/lib/schemaEvolution';
import type { UserData } from '../src/types';
import { emptyUserData } from './setup';

afterEach(() => {
    vi.restoreAllMocks();
});

describe('audit regression: emergency export local date', () => {
    it('exports only in-memory owner-scoped data and keeps the emergency download URL alive', async () => {
        const userData: UserData = {
            ...structuredClone(emptyUserData),
            history: [{ id: 'unsynced-session', date: '2026-09-18', exercises: [] }],
            nutrition: {
                '2026-09-18': { date: '2026-09-18', kcal: 2400, carbs: 260, pro: 155, fat: 70 }
            }
        };
        let backupBlob!: Blob;
        const before = useAppStore.getState();
        useAppStore.setState({ userData, dataOwner: 'user:test-user-id' });
        vi.useFakeTimers();
        try {
            const date = vi.spyOn(Logic, 'getLocalDateString').mockReturnValue('2026-09-18');
            const create = vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:logbook-test');
            const revoke = vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => {});

            let downloadedFilename = '';
            let downloadedHref = '';
            let clickedWhileAttached = false;
            vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(function (this: HTMLAnchorElement) {
                downloadedFilename = this.download;
                downloadedHref = this.getAttribute('href') ?? '';
                clickedWhileAttached = this.isConnected;
                expect(revoke).not.toHaveBeenCalled();
            });

            Exporter.exportEmergencyJSON(userData);

            expect(date).toHaveBeenCalledOnce();
            expect(create).toHaveBeenCalledOnce();
            const created = create.mock.calls[0]?.[0];
            expect(created).toBeInstanceOf(Blob);
            if (!(created instanceof Blob)) throw new Error('Il backup non contiene un Blob.');
            backupBlob = created;
            expect(backupBlob.type).toBe('application/json');
            expect(downloadedFilename).toBe('logbook_emergency_backup_2026-09-18.json');
            expect(downloadedHref).toBe('blob:logbook-test');
            expect(clickedWhileAttached).toBe(true);
            expect(document.querySelector('a[download="logbook_emergency_backup_2026-09-18.json"]')).toBeNull();

            await vi.advanceTimersByTimeAsync(999);
            expect(revoke).not.toHaveBeenCalled();
            await vi.advanceTimersByTimeAsync(1);
            expect(revoke).toHaveBeenCalledExactlyOnceWith('blob:logbook-test');
        } finally {
            vi.useRealTimers();
            useAppStore.setState({ userData: before.userData, dataOwner: before.dataOwner });
        }

        const jsonText = await new Promise<string>((resolve, reject) => {
            const reader = new FileReader();
            reader.onload = () => resolve(String(reader.result));
            reader.onerror = () => reject(reader.error ?? new Error('Lettura del backup non riuscita.'));
            reader.readAsText(backupBlob);
        });
        const backup: unknown = JSON.parse(jsonText);
        expect(backup).toMatchObject({
            format: 'logbook-backup',
            version: CURRENT_BACKUP_SCHEMA,
            dataSchemaVersion: CURRENT_DATA_SCHEMA,
            syncProtocolVersion: CURRENT_SYNC_PROTOCOL,
            type: 'backup',
            owner: 'user:test-user-id',
            coverage: { scope: 'device', months: [] },
            reason: 'logout-with-unsynced-data'
        });
        expect(backup).toHaveProperty('userData', userData);
        expect(backup).not.toHaveProperty('recovery.envelope');
        expect(backup).not.toHaveProperty('recovery.device');
    });

    it('releases the Blob URL and anchor when the browser refuses the emergency download', () => {
        const before = useAppStore.getState();
        const userData = structuredClone(emptyUserData) as UserData;
        const create = vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:blocked-emergency');
        const revoke = vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => {});
        vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {
            throw new Error('Browser download denied');
        });
        try {
            useAppStore.setState({ userData, dataOwner: 'user:test-user-id' });
            expect(() => Exporter.exportEmergencyJSON(userData)).toThrow('Browser download denied');
            expect(create).toHaveBeenCalledOnce();
            expect(revoke).toHaveBeenCalledExactlyOnceWith('blob:blocked-emergency');
            expect(document.querySelector('a[href="blob:blocked-emergency"]')).toBeNull();
        } finally {
            useAppStore.setState({ userData: before.userData, dataOwner: before.dataOwner });
        }
    });

    it('rejects stale or mismatched owner data before creating a downloadable backup', () => {
        const before = useAppStore.getState();
        const userData = { ...structuredClone(emptyUserData), profile: { height: '175' } } as UserData;
        const stale = structuredClone(userData);
        const create = vi.spyOn(URL, 'createObjectURL');
        try {
            useAppStore.setState({ userData, dataOwner: 'user:test-user-id' });
            expect(() => Exporter.exportEmergencyJSON(stale)).toThrow(/sessione cambiati/);

            useAppStore.setState({ dataOwner: 'guest' });
            expect(() => Exporter.exportEmergencyJSON(userData)).toThrow(/sessione cambiati/);
            expect(create).not.toHaveBeenCalled();
        } finally {
            useAppStore.setState({ userData: before.userData, dataOwner: before.dataOwner });
        }
    });
});