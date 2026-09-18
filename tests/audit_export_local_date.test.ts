import { afterEach, describe, expect, it, vi } from 'vitest';
import { Exporter } from '../src/lib/export';
import { Logic } from '../src/lib/logic';

afterEach(() => {
    vi.restoreAllMocks();
});

describe('audit regression: emergency export local date', () => {
    it('uses the canonical local date in the emergency backup filename', () => {
        vi.spyOn(Logic, 'getLocalDateString').mockReturnValue('2026-09-18');
        vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:logbook-test');
        vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => {});

        let downloadedFilename = '';
        vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(function (this: HTMLAnchorElement) {
            downloadedFilename = this.download;
        });

        Exporter.exportEmergencyJSON({ history: [], nutrition: {}, library: [], routines: [] } as any);

        expect(Logic.getLocalDateString).toHaveBeenCalledTimes(1);
        expect(downloadedFilename).toBe('logbook_emergency_backup_2026-09-18.json');
    });
});
