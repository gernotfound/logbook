import React from 'react';
import { fireEvent, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import SettingsView from '../../../src/components/SettingsView';
import { renderWithProviders } from '../../setup';

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
        expect(onClose).not.toHaveBeenCalled();
        expect(screen.getByRole('heading', { name: 'Impostazioni' })).toBeDefined();
        fireEvent.click(screen.getByRole('button', { name: /Dati e backup/i }));
        expect(screen.getByRole('heading', { name: 'Dati e backup' })).toBeDefined();
        expect(screen.getByRole('button', { name: /Esporta JSON/i })).toBeDefined();
        expect(screen.getByRole('button', { name: /Backup JSON/i })).toBeDefined();
        expect(screen.getByRole('button', { name: /Esporta dati \(CSV\)/i })).toBeDefined();
    });

    it('explains irreversible deletion and offers an optional export before consent withdrawal', () => {
        renderWithProviders(<SettingsView />);
        fireEvent.click(screen.getByRole('button', { name: /^Privacy/i }));
        fireEvent.click(screen.getByRole('button', { name: /Revoca il consenso per i dati salute/ }));
        const section = screen.getByRole('region', { name: 'Conferma revoca del consenso' });
        expect(section.textContent).toMatch(/cancellazione definitiva/i);
        expect(section.textContent).toMatch(/account di accesso rimane esistente/i);
        expect(section.textContent).toMatch(/esportazione è facoltativa/i);
        expect(section.textContent).toMatch(/informazioni sulla salute in chiaro/i);
        expect(screen.getByRole('button', { name: 'Esporta prima i miei dati' })).toBeDefined();
        expect(screen.getByRole('button', { name: 'Revoca il consenso e cancella i dati' })).toBeDefined();
        fireEvent.click(screen.getByRole('button', { name: 'Annulla' }));
        expect(screen.queryByRole('region', { name: 'Conferma revoca del consenso' })).toBeNull();
    });

    it.each([
        ['Informativa sulla privacy', 'Chiudi informativa'],
        ['Termini e condizioni', 'Chiudi termini'],
    ])('opens and dismisses the %s dialog without leaving settings', (label, closeLabel) => {
        const onClose = vi.fn();
        renderWithProviders(<SettingsView onClose={onClose} />);
        fireEvent.click(screen.getByRole('button', { name: /^Privacy/i }));

        fireEvent.click(screen.getByRole('button', { name: label }));
        const dialog = screen.getByRole('dialog', { name: label });
        expect(dialog.getAttribute('aria-modal')).toBe('true');
        expect(screen.getByRole('button', { name: closeLabel })).toBeDefined();
        fireEvent.click(screen.getByRole('button', { name: closeLabel }));

        expect(screen.queryByRole('dialog', { name: label })).toBeNull();
        expect(screen.getByRole('heading', { name: 'Privacy' })).toBeDefined();
        expect(onClose).not.toHaveBeenCalled();
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

    it('updates the offline notice on connectivity events without leaving application settings', () => {
        renderWithProviders(<SettingsView />);
        fireEvent.click(screen.getByRole('button', { name: /Aspetto e applicazione/i }));

        fireEvent(window, new Event('offline'));
        const notice = screen.getByText('Connessione assente').closest('[role="status"]');
        expect(notice?.classList.contains('settings-offline-card')).toBe(true);
        expect(screen.getByRole('heading', { name: 'Aspetto e applicazione' })).toBeDefined();

        fireEvent(window, new Event('online'));
        expect(screen.queryByText('Connessione assente')).toBeNull();
        expect(screen.getByRole('heading', { name: 'Aspetto e applicazione' })).toBeDefined();
    });

    it('returns to Home from the settings landing', () => {
        const onClose = vi.fn();
        renderWithProviders(<SettingsView onClose={onClose} />);
        fireEvent.click(screen.getByRole('button', { name: 'Torna alla Home' }));
        expect(onClose).toHaveBeenCalledTimes(1);
    });
});
