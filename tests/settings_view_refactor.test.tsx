import React from 'react';
import { fireEvent, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import SettingsView from '../src/components/SettingsView';
import { renderWithProviders } from './setup';

describe('SettingsView hierarchical navigation', () => {
    it('opens the settings areas and preserves privacy/data content', () => {
        const onClose = vi.fn();
        renderWithProviders(<SettingsView onClose={onClose} />);

        expect(screen.getByRole('heading', { name: 'Impostazioni' })).toBeDefined();
        expect(screen.getByRole('button', { name: /Account e accesso/i })).toBeDefined();
        expect(screen.getByRole('button', { name: /^Privacy/i })).toBeDefined();
        expect(screen.getByRole('button', { name: /Dati e backup/i })).toBeDefined();
        expect(screen.getByRole('button', { name: /Aspetto e applicazione/i })).toBeDefined();

        fireEvent.click(screen.getByRole('button', { name: /^Privacy/i }));
        expect(screen.getByRole('heading', { name: 'Privacy' })).toBeDefined();
        expect(screen.getByRole('button', { name: /Termini e condizioni/i })).toBeDefined();
        expect(screen.getByRole('button', { name: /Informativa sulla privacy/i })).toBeDefined();
        expect(screen.queryByRole('checkbox', { name: 'Statistiche di utilizzo' })).toBeNull();

        fireEvent.click(screen.getByRole('button', { name: 'Torna alle impostazioni' }));
        fireEvent.click(screen.getByRole('button', { name: /Dati e backup/i }));
        expect(screen.getByRole('heading', { name: 'Dati e backup' })).toBeDefined();
        expect(screen.getByRole('button', { name: /Esporta JSON/i })).toBeDefined();
        expect(screen.getByRole('button', { name: /Backup JSON/i })).toBeDefined();
        expect(screen.getByRole('button', { name: /Esporta dati \(CSV\)/i })).toBeDefined();
    });

    it('groups theme, updates and storage diagnostics under Aspetto e applicazione', () => {
        renderWithProviders(<SettingsView />);
        fireEvent.click(screen.getByRole('button', { name: /Aspetto e applicazione/i }));

        expect(screen.getByRole('heading', { name: 'Aspetto e applicazione' })).toBeDefined();
        expect(screen.getByRole('radio', { name: 'Sistema' })).toBeDefined();
        expect(screen.getByRole('radio', { name: 'Chiaro' })).toBeDefined();
        expect(screen.getByRole('radio', { name: 'Scuro' })).toBeDefined();
        expect(screen.getByRole('heading', { name: 'Tema' })).toBeDefined();
        expect(screen.getByRole('button', { name: /Cerca aggiornamenti/i })).toBeDefined();
        expect(screen.getByText(/Diagnostica archiviazione/i)).toBeDefined();
        expect(screen.getByText(/Versione .* build/i)).toBeDefined();
    });

    it('returns to Home from the settings landing', () => {
        const onClose = vi.fn();
        renderWithProviders(<SettingsView onClose={onClose} />);
        fireEvent.click(screen.getByRole('button', { name: 'Torna alla Home' }));
        expect(onClose).toHaveBeenCalledTimes(1);
    });
});
