import React from 'react';
import { fireEvent, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import SettingsView from '../src/components/SettingsView';
import { renderWithProviders } from './setup';

describe('SettingsView decomposition parity', () => {
    it('preserves account, privacy, and export tab content', () => {
        renderWithProviders(<SettingsView />);

        expect(screen.queryByRole('button', { name: /Cerca aggiornamenti/i })).toBeNull();
        expect(screen.queryByText(/Diagnostica archiviazione/i)).toBeNull();

        fireEvent.click(screen.getByRole('tab', { name: 'Privacy' }));
        expect(screen.getByRole('button', { name: /Termini e Condizioni/i })).toBeDefined();
        expect(screen.getByRole('button', { name: /Informativa sulla Privacy/i })).toBeDefined();
        expect(document.querySelector('#analytics-toggle')).not.toBeNull();

        fireEvent.click(screen.getByRole('tab', { name: 'Esporta' }));
        expect(screen.getByRole('button', { name: /Esporta JSON/i })).toBeDefined();
        expect(screen.getByRole('button', { name: /Backup JSON/i })).toBeDefined();
        expect(screen.queryByRole('button', { name: /Esporta archivio precedente/i })).toBeNull();
        expect(screen.getByRole('button', { name: /Esporta dati \(CSV\)/i })).toBeDefined();
    });

    it('groups appearance, updates, and storage diagnostics under Sistema', () => {
        renderWithProviders(<SettingsView />);
        fireEvent.click(screen.getByRole('tab', { name: 'Sistema' }));
        expect(screen.getByRole('tabpanel', { name: 'Sistema' })).toBeDefined();
        expect(screen.getByRole('radio', { name: 'Sistema' })).toBeDefined();
        expect(screen.getByRole('radio', { name: 'Chiaro' })).toBeDefined();
        expect(screen.getByRole('radio', { name: 'Scuro' })).toBeDefined();
        expect(screen.getByRole('button', { name: /Cerca aggiornamenti/i })).toBeDefined();
        expect(screen.getByText(/Diagnostica archiviazione/i)).toBeDefined();
    });
});
