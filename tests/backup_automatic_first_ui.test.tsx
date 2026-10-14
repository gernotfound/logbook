import React from 'react';
import { render, screen, cleanup } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ExportSettingsTab } from '../src/components/Settings/ExportSettingsTab';

afterEach(cleanup);

function renderBackupTab(isGuest: boolean) {
    return render(<ExportSettingsTab
        isGuest={isGuest}
        exportLibrary="none" exportRoutines="none" exportTrainingCycles="none"
        onLibrarySelectionChange={vi.fn()} onRoutinesSelectionChange={vi.fn()}
        onTrainingCyclesSelectionChange={vi.fn()} onExportShare={vi.fn()}
        onExportBackup={vi.fn()} onExportCSV={vi.fn()} onImportFile={vi.fn()}
        importingData={false} exportingData={false}
    />);
}

describe('automatic-first backup experience', () => {
    it('does not tell account users that periodic manual exports are required', () => {
        const { container } = renderBackupTab(false);
        expect(screen.getByText(/salva automaticamente sul dispositivo e sincronizza/i)).toBeDefined();
        expect(screen.getByText(/Non sono necessarie esportazioni periodiche/i)).toBeDefined();
        expect(screen.getByText(/Le modifiche non ancora sincronizzate/i)).toBeDefined();
        expect(screen.getByRole('button', { name: 'Backup JSON' })).toBeDefined();
        expect(container.textContent).not.toMatch(/salva periodicamente/i);
    });

    it('does not promise a cloud copy for unauthenticated guest data', () => {
        renderBackupTab(true);
        expect(screen.getByText(/Non esiste una copia cloud associata a un account/i)).toBeDefined();
        expect(screen.getByText(/Il Backup JSON è facoltativo/i)).toBeDefined();
    });
});
