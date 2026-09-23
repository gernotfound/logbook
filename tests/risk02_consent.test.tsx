import { describe, it, expect, vi, beforeEach } from 'vitest';
import { useAppStore } from '../src/store/useAppStore';
import { DB } from '../src/lib/db';
import { LEGAL_VERSIONS, needsLegalUpdate } from '../src/lib/legalVersions';
import { defaultUserDataFallback } from '../src/lib/schema';

describe('RISK-02: Legal Consent Lifecycle', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        vi.restoreAllMocks();
        // Reset store con dati fittizi
        useAppStore.setState({
            userData: defaultUserDataFallback,
            localWorkout: null,
            saveError: null,
            syncHealth: 'synced',
            syncing: false
        });
    });

    const mockConsent = {
        hasAcceptedTerms: true,
        hasAcceptedHealthData: true,
        acceptedAt: new Date().toISOString(),
        privacyVersion: LEGAL_VERSIONS.privacy,
        termsVersion: LEGAL_VERSIONS.terms
    };

    it('richiede un nuovo consenso quando una versione legale precedente non coincide', () => {
        expect(LEGAL_VERSIONS.privacy).toBe('1.2.2');
        expect(LEGAL_VERSIONS.terms).toBe('1.2.0');
        expect(needsLegalUpdate({
            ...mockConsent,
            privacyVersion: '1.2.1'
        })).toBe(true);
        expect(needsLegalUpdate({
            ...mockConsent,
            termsVersion: '1.0.1'
        })).toBe(true);
        expect(needsLegalUpdate(mockConsent)).toBe(false);
    });

    it('Scenario 1: Successo Remoto - Il consenso aggiorna IndexedDB e lo store', async () => {
        vi.spyOn(DB, 'saveUserData').mockResolvedValue({ ok: true, status: 'synced' });

        await useAppStore.getState().submitLegalConsent(mockConsent);

        // Verifica che DB sia stato chiamato prima dell'aggiornamento
        expect(DB.saveUserData).toHaveBeenCalledTimes(1);
        
        // Verifica che lo store sia stato aggiornato DOPO il successo
        const state = useAppStore.getState();
        expect(state.userData?.legalConsent).toEqual(mockConsent);
        expect(state.syncHealth).toBe('synced');
    });

    it('Scenario 2: Offline (local-pending) - Il consenso è accettato localmente', async () => {
        vi.spyOn(DB, 'saveUserData').mockResolvedValue({ ok: false, status: 'local-pending' });

        await useAppStore.getState().submitLegalConsent(mockConsent);

        const state = useAppStore.getState();
        // Essendo offline-first, local-pending è trattato come successo
        expect(state.userData?.legalConsent).toEqual(mockConsent);
        expect(state.syncHealth).toBe('local-pending');
    });

    it('Scenario 3: Errore Remoto (rejected) - Nessun dato sporcato', async () => {
        vi.spyOn(DB, 'saveUserData').mockResolvedValue({ ok: false, status: 'rejected' });

        const promise = useAppStore.getState().submitLegalConsent(mockConsent);
        await expect(promise).rejects.toThrow("Sincronizzazione rifiutata dal server");

        const state = useAppStore.getState();
        // Il campo legalConsent DEVE rimanere undefined/null per lasciare l'overlay aperto
        expect(state.userData?.legalConsent).toBeUndefined();
        expect(state.syncHealth).toBe('rejected');
    });
});

import React from 'react';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { ConsentOverlay } from '../src/components/UI/ConsentOverlay';
import { PrivacyPolicy } from '../src/pages/PrivacyPolicy';
import { useDialogStore } from '../src/store/useDialogStore';

vi.mock('../src/hooks/useAuth', () => ({
    useAuth: () => ({ isGuest: false })
}));
vi.mock('../src/hooks/useSettings', () => ({
    useSettings: () => ({ handleExportCSV: vi.fn(), handleDeleteAccount: vi.fn() })
}));
vi.mock('../src/hooks/useScrollLock', () => ({
    useScrollLock: vi.fn()
}));

describe('RISK-02: ConsentOverlay UI Behavior', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        vi.restoreAllMocks();
        useDialogStore.setState({ dialogType: null, dialogMessage: '' });
        useAppStore.setState({
            userData: defaultUserDataFallback,
            localWorkout: null,
            saveError: null,
            syncHealth: 'synced',
            syncing: false
        });
    });

    it('Isola il focus dentro il consenso finch? il gate ? aperto', () => {
        render(<><button type="button">Fuori overlay</button><ConsentOverlay /></>);
        const dialog = screen.getByRole('dialog', { name: /Aggiornamento Termini e Privacy/i });
        expect(dialog.getAttribute('aria-modal')).toBe('true');

        const checkboxes = screen.getAllByRole('checkbox');
        expect(document.activeElement).toBe(checkboxes[0]);

        const last = screen.getByRole('button', { name: /Elimina account permanentemente/i });
        last.focus();
        fireEvent.keyDown(last, { key: 'Tab' });
        expect(document.activeElement).toBe(checkboxes[0]);

        checkboxes[0].focus();
        fireEvent.keyDown(checkboxes[0], { key: 'Tab', shiftKey: true });
        expect(document.activeElement).toBe(last);
        expect(document.activeElement).not.toBe(screen.getByRole('button', { name: 'Fuori overlay' }));
    });

    it('presenta eta, informativa e termini senza dichiarare conformita legale', () => {
        render(<ConsentOverlay />);
        expect(screen.getByText(/almeno 18 anni/i)).toBeDefined();
        expect(screen.getByRole('button', { name: /Informativa sulla Privacy/i })).toBeDefined();
        expect(screen.getByRole('button', { name: /Termini e Condizioni/i })).toBeDefined();
        expect(screen.queryByText(/essere conformi/i)).toBeNull();
    });

    it('chiarisce che una palestra non riceve automaticamente accesso ai dati degli iscritti', () => {
        render(<PrivacyPolicy onClose={vi.fn()} />);
        expect(screen.getByText(/non riceve per questo motivo accesso ai loro dati in LogBook/i)).toBeDefined();
    });

    it('Pulsante disabilitato se consenso incompleto', () => {
        render(<ConsentOverlay />);
        const button = screen.getByRole('button', { name: /accetta e continua/i }) as HTMLButtonElement;
        expect(button.disabled).toBe(true);
    });

    it('Abilita pulsante solo dopo aver spuntato entrambe le checkbox', () => {
        render(<ConsentOverlay />);
        const button = screen.getByRole('button', { name: /accetta e continua/i }) as HTMLButtonElement;
        const checkboxes = screen.getAllByRole('checkbox');
        
        fireEvent.click(checkboxes[0]);
        expect(button.disabled).toBe(true);
        
        fireEvent.click(checkboxes[1]);
        expect(button.disabled).toBe(false);
    });

    it('Doppio click bloccato e pulsante in stato Salvataggio', async () => {
        let resolveSave: any;
        const savePromise = new Promise<{ok: boolean, status: string}>(res => { resolveSave = res; });
        vi.spyOn(DB, 'saveUserData').mockReturnValue(savePromise);

        render(<ConsentOverlay />);
        const checkboxes = screen.getAllByRole('checkbox');
        fireEvent.click(checkboxes[0]);
        fireEvent.click(checkboxes[1]);
        
        const button = screen.getByRole('button', { name: /accetta e continua/i }) as HTMLButtonElement;
        fireEvent.click(button);
        
        // Il testo cambia e il pulsante è disabilitato (previene doppio click)
        expect(button.disabled).toBe(true);
        expect(button.textContent).toContain('Salvataggio...');
        
        // Secondo click (simulato per sicurezza, ma disabilitato dal DOM)
        fireEvent.click(button);
        await waitFor(() => expect(DB.saveUserData).toHaveBeenCalledTimes(1));

        resolveSave({ ok: true, status: 'synced' });
        await waitFor(() => expect(useAppStore.getState().userData?.legalConsent).toBeDefined());
    });

    it('Rejection mantiene overlay visibile e mostra alert', async () => {
        vi.spyOn(DB, 'saveUserData').mockResolvedValue({ ok: false, status: 'rejected' });
        vi.spyOn(useDialogStore.getState(), 'showAlert');

        render(<ConsentOverlay />);
        const checkboxes = screen.getAllByRole('checkbox');
        fireEvent.click(checkboxes[0]);
        fireEvent.click(checkboxes[1]);
        
        const button = screen.getByRole('button', { name: /accetta e continua/i }) as HTMLButtonElement;
        fireEvent.click(button);

        // Attendi che l'alert sia stato mostrato
        await waitFor(() => {
            expect(useDialogStore.getState().showAlert).toHaveBeenCalledWith(
                expect.stringContaining('Errore durante il salvataggio del consenso')
            );
        });

        // Il pulsante deve essere di nuovo riabilitato per il retry
        expect(button.disabled).toBe(false);
        expect(button.textContent).toContain('Accetta e continua');
        // Lo stato non è stato sporcato
        expect(useAppStore.getState().userData?.legalConsent).toBeUndefined();
        // Lo stato globale riflette l'errore
        expect(useAppStore.getState().syncHealth).toBe('rejected');
    });

    it('Failed (errore inatteso) mantiene overlay visibile e aggiorna syncHealth', async () => {
        vi.spyOn(DB, 'saveUserData').mockResolvedValue({ ok: false, status: 'failed' });
        vi.spyOn(useDialogStore.getState(), 'showAlert');

        render(<ConsentOverlay />);
        const checkboxes = screen.getAllByRole('checkbox');
        fireEvent.click(checkboxes[0]);
        fireEvent.click(checkboxes[1]);
        
        const button = screen.getByRole('button', { name: /accetta e continua/i }) as HTMLButtonElement;
        fireEvent.click(button);

        await waitFor(() => {
            expect(useDialogStore.getState().showAlert).toHaveBeenCalled();
        });

        expect(button.disabled).toBe(false);
        expect(useAppStore.getState().userData?.legalConsent).toBeUndefined();
        expect(useAppStore.getState().syncHealth).toBe('failed');
    });
});
