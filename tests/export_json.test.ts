import { describe, it, expect, vi } from 'vitest';
import { Exporter } from '../src/lib/export';
import { useDialogStore } from '../src/store/useDialogStore';

// Mock per il download file per non far crashare i test in JSDOM
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
    it('exportShareJson contains only shared fields', async () => {
        const mockUserData: any = {
            profile: { dob: '2000-01-01' },
            library: [{ id: 'ex1', name: 'Panca', setsCount: 3, sets: [] }],
            routines: [{ id: 'r1', name: 'A', exercises: [] }],
            trainingCycles: [{ id: 'c1', name: 'Ciclo 1', durationWeeks: 4, routines: [] }],
            history: [{ id: 'h1', date: '2023-01-01', routineName: 'A', exercises: [] }]
        };

        const downloadSpy = vi.spyOn(Exporter, 'downloadFile').mockImplementation(async () => {});
        
        await Exporter.exportShareJson(mockUserData);
        
        expect(downloadSpy).toHaveBeenCalled();
        const [, content] = downloadSpy.mock.calls[0];
        const parsed = JSON.parse(content);
        
        expect(parsed.type).toBe('share');
        expect(parsed.library.length).toBe(1);
        expect(parsed.history).toBeUndefined();
        expect(parsed.profile).toBeUndefined();
    });

    it('exportBackupJson contains all fields and user ID', async () => {
        const mockUserData: any = {
            profile: { dob: '2000-01-01' },
            history: [{ id: 'h1', date: '2023-01-01', routineName: 'A', exercises: [] }]
        };
        const mockUser = { uid: 'user123' };

        const downloadSpy = vi.spyOn(Exporter, 'downloadFile').mockImplementation(async () => {});
        downloadSpy.mockClear();
        
        await Exporter.exportBackupJson(mockUserData, mockUser);
        
        expect(downloadSpy).toHaveBeenCalled();
        const [, content] = downloadSpy.mock.calls[0];
        const parsed = JSON.parse(content);
        
        expect(parsed.type).toBe('backup');
        expect(parsed.userId).toBe('user123');
        expect(parsed.history.length).toBe(1);
        expect(parsed.profile.dob).toBe('2000-01-01');
    });

    it('importFromJson blocks importing backup from different user', async () => {
        const fakeFileContent = JSON.stringify({
            version: 1,
            type: 'backup',
            userId: 'alien456',
            history: [{ id: 'h2' }]
        });
        
        const file = new File([fakeFileContent], "test.json", { type: "application/json" });
        const mockCurrentUser = { uid: 'user123' };
        
        const saveUserDataMock = vi.fn();
        const alertSpy = vi.spyOn(useDialogStore.getState(), 'showAlert');
        
        await expect(Exporter.importFromJson(file, mockCurrentUser, saveUserDataMock)).rejects.toThrow();
        expect(saveUserDataMock).not.toHaveBeenCalled();
        expect(alertSpy).toHaveBeenCalledWith(expect.stringContaining('Sicurezza: Non puoi importare il backup di un altro utente'));
    });
});
