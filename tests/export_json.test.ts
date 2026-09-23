import { describe, it, expect, vi } from 'vitest';
import { Exporter } from '../src/lib/export';
import { createBackup } from '../src/lib/backup';
import { useDialogStore } from '../src/store/useDialogStore';
import { CURRENT_BACKUP_SCHEMA, CURRENT_DATA_SCHEMA, CURRENT_SYNC_PROTOCOL } from '../src/lib/schemaEvolution';

const originalCreateElement = document.createElement.bind(document);
vi.spyOn(document, 'createElement').mockImplementation((tagName) => {
    if (tagName === 'a') {
        return {
            setAttribute: vi.fn(),
            click: vi.fn(),
            style: {},
        } as any;
    }
    return originalCreateElement(tagName);
});

describe('JSON Export/Import Logic', () => {
    it('exportShareJson uses the current versioned envelope and contains only shared fields', async () => {
        const mockUserData: any = {
            profile: { dob: '2000-01-01' },
            library: [{ id: 'ex1', name: 'Panca', setsCount: 3, sets: [] }],
            routines: [{ id: 'r1', name: 'A', exercises: [] }],
            trainingCycles: [{
                id: 'c1',
                name: 'Ciclo 1',
                durationWeeks: 4,
                strategy: { intent: 'development', progressionFocus: 'volume', primaryMuscles: ['quads'] },
                routines: []
            }],
            history: [{ id: 'h1', date: '2023-01-01', routineName: 'A', exercises: [] }]
        };

        const downloadSpy = vi.spyOn(Exporter, 'downloadFile').mockImplementation(async () => {});
        await Exporter.exportShareJson(mockUserData);

        const [, content] = downloadSpy.mock.calls[0];
        const parsed = JSON.parse(content);

        expect(parsed).toMatchObject({
            format: 'logbook-backup',
            version: CURRENT_BACKUP_SCHEMA,
            dataSchemaVersion: CURRENT_DATA_SCHEMA,
            syncProtocolVersion: CURRENT_SYNC_PROTOCOL,
            type: 'share',
        });
        expect(parsed.userData.library.length).toBe(1);
        expect(parsed.userData.history).toBeUndefined();
        expect(parsed.userData.profile).toBeUndefined();
        expect(parsed.userData.trainingCycles[0].strategy).toEqual({
            intent: 'development',
            progressionFocus: 'volume',
            primaryMuscles: ['quads']
        });
    });

    it('exportBackupJson contains all fields, owner and independent versions', async () => {
        const mockUserData: any = {
            profile: { dob: '2000-01-01' },
            history: [{ id: 'h1', date: '2023-01-01', routineName: 'A', exercises: [] }]
        };
        const mockUser = { uid: 'user123' };

        const downloadSpy = vi.spyOn(Exporter, 'downloadFile').mockImplementation(async () => {});
        downloadSpy.mockClear();
        await Exporter.exportBackupJson(mockUserData, mockUser);

        const [, content] = downloadSpy.mock.calls[0];
        const parsed = JSON.parse(content);

        expect(parsed.type).toBe('backup');
        expect(parsed.version).toBe(CURRENT_BACKUP_SCHEMA);
        expect(parsed.dataSchemaVersion).toBe(CURRENT_DATA_SCHEMA);
        expect(parsed.syncProtocolVersion).toBe(CURRENT_SYNC_PROTOCOL);
        expect(parsed.owner).toBe('user:user123');
        expect(parsed.coverage.scope).toBe('device');
        expect(parsed.userData.history.length).toBe(1);
        expect(parsed.userData.profile.dob).toBe('2000-01-01');
    });

    it('importFromJson blocks importing a current backup from a different user', async () => {
        const payload = createBackup({ history: [{ id: 'h2' }] } as any, 'user:alien456');
        const file = new File([JSON.stringify(payload)], "test.json", { type: "application/json" });
        const saveUserDataMock = vi.fn();
        const alertSpy = vi.spyOn(useDialogStore.getState(), 'showAlert');

        await expect(Exporter.importFromJson(file, { uid: 'user123' }, saveUserDataMock)).rejects.toThrow();
        expect(saveUserDataMock).not.toHaveBeenCalled();
        expect(alertSpy).toHaveBeenCalledWith(expect.stringContaining('Sicurezza: Non puoi importare il backup di un altro utente'));
    });

    it('exportShareJson with granular array applies dependency resolution', async () => {
        const mockUserData: any = {
            library: [
                { id: 'ex1', name: 'Squat', setsCount: 3, sets: [] },
                { id: 'ex2', name: 'Bench', setsCount: 3, sets: [] },
                { id: 'ex3', name: 'Deadlift', setsCount: 3, sets: [] }
            ],
            routines: [
                { id: 'r1', name: 'Legs', exercises: [{ exId: 'ex1' }] },
                { id: 'r2', name: 'Push', exercises: [{ exId: 'ex2' }] }
            ],
            trainingCycles: [
                { id: 'c1', name: 'Starting Strength', durationWeeks: 12, routines: [{ routineId: 'r1', frequencyPerWeek: 1 }, { routineId: 'r2', frequencyPerWeek: 1 }] }
            ]
        };

        const downloadSpy = vi.spyOn(Exporter, 'downloadFile').mockImplementation(async () => {});
        downloadSpy.mockClear();
        await Exporter.exportShareJson(mockUserData, {
            exportTrainingCycles: ['c1'],
            exportRoutines: [],
            exportLibrary: []
        });

        const [, content] = downloadSpy.mock.calls[0];
        const parsed = JSON.parse(content).userData;

        expect(parsed.trainingCycles).toHaveLength(1);
        expect(parsed.trainingCycles[0].id).toBe('c1');
        expect(parsed.routines).toHaveLength(2);
        expect(parsed.routines.map((r: any) => r.id)).toEqual(expect.arrayContaining(['r1', 'r2']));
        expect(parsed.library).toHaveLength(2);
        expect(parsed.library.map((e: any) => e.id)).toEqual(expect.arrayContaining(['ex1', 'ex2']));
        expect(parsed.library.find((e: any) => e.id === 'ex3')).toBeUndefined();
    });

    it('exportShareJson with empty items and non-existent dependencies exports gracefully', async () => {
        const mockUserData: any = {
            library: [],
            routines: [{ id: 'empty_r', name: 'Empty Routine', exercises: [] }],
            trainingCycles: [{ id: 'broken_c', name: 'Broken', durationWeeks: 4, routines: [{ routineId: 'ghost_r', frequencyPerWeek: 1 }] }]
        };

        const downloadSpy = vi.spyOn(Exporter, 'downloadFile').mockImplementation(async () => {});
        downloadSpy.mockClear();
        await Exporter.exportShareJson(mockUserData, {
            exportTrainingCycles: ['broken_c'],
            exportRoutines: ['empty_r'],
            exportLibrary: ['ghost_ex']
        });

        const [, content] = downloadSpy.mock.calls[0];
        const parsed = JSON.parse(content).userData;

        expect(parsed.trainingCycles).toHaveLength(1);
        expect(parsed.routines).toHaveLength(1);
        expect(parsed.library).toHaveLength(0);
    });
});
