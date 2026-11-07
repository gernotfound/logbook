import { afterEach, describe, expect, it, vi } from 'vitest';
import { Exporter } from '../src/lib/export';
import { Logic } from '../src/lib/logic';
import { CURRENT_BACKUP_SCHEMA, CURRENT_DATA_SCHEMA, CURRENT_SYNC_PROTOCOL } from '../src/lib/schemaEvolution';
import type { UserData } from '../src/types';
import { emptyUserData } from './setup';

afterEach(() => {
    vi.restoreAllMocks();
});

describe('audit regression: emergency export local date', () => {
    it('downloads a complete owner-scoped emergency backup and revokes its temporary URL after the click', async () => {
        const userData: UserData = {
            ...structuredClone(emptyUserData),
            history: [{ id: 'unsynced-session', date: '2026-09-18', exercises: [] }],
            nutrition: {
                '2026-09-18': { date: '2026-09-18', kcal: 2400, carbs: 260, pro: 155, fat: 70 }
            }
        };
        let backupBlob!: Blob;
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

            await vi.advanceTimersByTimeAsync(99);
            expect(revoke).not.toHaveBeenCalled();
            await vi.advanceTimersByTimeAsync(1);
            expect(revoke).toHaveBeenCalledExactlyOnceWith('blob:logbook-test');
        } finally {
            vi.useRealTimers();
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
    });
});
