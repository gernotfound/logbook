import { describe, it, expect, vi, beforeEach } from 'vitest';
import { useAppStore } from '../src/store/useAppStore';
import { DB } from '../src/lib/db';
import { get } from 'idb-keyval';
import { readLocal } from '../src/lib/sync/localRepository';
import { invalidateSession } from '../src/lib/sync/session';
import { LEGAL_VERSIONS, needsLegalUpdate } from '../src/lib/legalVersions';
import { defaultUserDataFallback } from '../src/lib/schema';
import type { SyncResult } from '../src/types';
import { prepareUnlockedTestArchive } from './secureVaultFixture';

describe('RISK-02: Legal Consent Lifecycle', () => {
    beforeEach(async () => {
        vi.clearAllMocks();
        vi.restoreAllMocks();
        await prepareUnlockedTestArchive('user:test-user-id');
        // Reset store con dati fittizi
        useAppStore.setState({
            dataOwner: 'user:test-user-id',
            userData: defaultUserDataFallback,
            localWorkout: null,
            saveError: null,
            syncHealth: 'synced',
            syncing: false,
            localPersistenceBlocked: false
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
        expect(LEGAL_VERSIONS.privacy).toBe('1.3.7');
        expect(needsLegalUpdate({ ...mockConsent, privacyVersion: '1.3.6' })).toBe(true);
        expect(needsLegalUpdate({ ...mockConsent, privacyVersion: '1.3.3' })).toBe(true);
        expect(LEGAL_VERSIONS.terms).toBe('1.2.3');
        expect(needsLegalUpdate({ ...mockConsent, termsVersion: '1.2.2' })).toBe(true);
        expect(needsLegalUpdate({ ...mockConsent, termsVersion: '1.2.1' })).toBe(true);
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

    it('Scenario 2: local-pending persists the legalConsent domain operation, not trusted server health authorization', async () => {
        vi.spyOn(DB, 'saveUserData').mockResolvedValue({ ok: false, status: 'local-pending', error: { code: 'unavailable' } });

        await useAppStore.getState().submitLegalConsent(mockConsent);

        const state = useAppStore.getState();
        // This is local durable business state, not permission for first-time account health consent.
        expect(state.userData?.legalConsent).toEqual(mockConsent);
        expect(state.syncHealth).toBe('local-pending');
    });


    it.each(['auth epoch', 'consent generation', 'consent withdrawal'] as const)(
        'preserves the encrypted journal when a late consent failure belongs to a stale %s',
        async boundary => {
            let complete!: (value: SyncResult) => void;
            vi.spyOn(DB, 'saveUserData').mockReturnValue(new Promise<SyncResult>(resolve => { complete = resolve; }));
            const operation = useAppStore.getState().submitLegalConsent(mockConsent)
                .then(() => undefined, (error: unknown) => error);
            await waitFor(() => expect(DB.saveUserData).toHaveBeenCalledTimes(1));
            const key = 'logbook:v2:user:test-user-id';
            const before = await readLocal('user:test-user-id');
            const encrypted = await get(key);
            expect(encrypted).toMatch(/^tlb-sealed:v1:/);
            expect(before?.pending.some(op => op.path[0] === 'legalConsent')).toBe(true);

            if (boundary === 'auth epoch') {
                // The same UID and unlocked vault do not prove continuity after A→B→A.
                invalidateSession();
                invalidateSession();
            } else {
                const suffix = boundary === 'consent generation' ? 'generation' : 'withdrawal';
                localStorage.setItem(key + ':health-consent-' + suffix, '2');
            }
            complete({ ok: false, status: 'rejected', error: { code: 'permission-denied' } });

            expect(await operation).toBeInstanceOf(Error);
            expect(await get(key)).toBe(encrypted);
            expect(await readLocal('user:test-user-id')).toEqual(before);
            expect(useAppStore.getState().userData?.legalConsent).toBeUndefined();
        },
    );

    it('Scenario 3: Errore Remoto (rejected) - Nessun dato sporcato', async () => {
        vi.spyOn(DB, 'saveUserData').mockResolvedValue({ ok: false, status: 'rejected', error: { code: 'permission-denied' } });

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
import { TermsAndConditions } from '../src/pages/TermsAndConditions';
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
    beforeEach(async () => {
        vi.clearAllMocks();
        vi.restoreAllMocks();
        await prepareUnlockedTestArchive('user:test-user-id');
        useDialogStore.setState({ isOpen: false, message: '' });
        useAppStore.setState({
            dataOwner: 'user:test-user-id',
            userData: defaultUserDataFallback,
            localWorkout: null,
            saveError: null,
            syncHealth: 'synced',
            syncing: false,
            localPersistenceBlocked: false
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
        expect(screen.getByText(/Il file JSON esportato non è cifrato/i)).toBeDefined();
        expect(screen.getByRole('button', { name: /Backup JSON dei tuoi dati/i })).toBeDefined();
    });

    it('chiarisce che altre persone e palestre non accedono ai dati dell’account', () => {
        render(<PrivacyPolicy onClose={vi.fn()} />);
        expect(screen.getByText(/Nessun altro utente, palestra o allenatore dispone nell'app di un accesso ai dati del tuo account/)).toBeDefined();
    });

    it('descrive la rimozione di GA4 e la data dell’informativa aggiornata', () => {
        render(<PrivacyPolicy onClose={vi.fn()} />);
        expect(screen.getByText('Aggiornata al 5 novembre 2026')).toBeDefined();
        expect(screen.getByText(/non integra Google Analytics 4/i)).toBeDefined();
        expect(screen.queryByText(/cookie first-party tecnici\/analitici/i)).toBeNull();
    });


    it('comunica assenza di monitoraggio esterno e conserva le informazioni sulla cifratura', () => {
        render(<PrivacyPolicy onClose={vi.fn()} />);
        expect(screen.getByText(/non utilizza un servizio esterno di Error Monitoring/i)).toBeDefined();
        expect(screen.getByText(/non crea code di report diagnostici/)).toBeDefined();
        expect(screen.getByText(/Le chiavi sono conservate nello stesso profilo del browser/)).toBeDefined();
        expect(screen.getByText(/non costituisce cifratura end-to-end/)).toBeDefined();
    });

    it('documenta revoca, diritti e titolare senza segnaposto di lavorazione', () => {
        render(<PrivacyPolicy onClose={vi.fn()} />);
        expect(screen.getByText('Revoca del consenso per i dati salute')).toBeDefined();
        expect(screen.getByText(/non puoi utilizzare le funzioni di allenamento/)).toBeDefined();
        expect(screen.queryByText(/DA DEFINIRE E VALIDARE/)).toBeNull();
        expect(screen.getByText(/dopo che il server ha confermato la revoca/)).toBeDefined();
        expect(screen.getByText(/inclusi allenamenti, nutrizione, misurazioni, routine e profilo applicativo/)).toBeDefined();
        expect(screen.getByText(/i dati già salvati non vengono cancellati automaticamente/)).toBeDefined();
        expect(screen.getByText(/possono utilizzare propri identificatori tecnici/)).toBeDefined();
        expect(screen.getByText(/Firebase Authentication elabora i dati di accesso negli Stati Uniti/)).toBeDefined();
        expect(screen.getByText(/data di nascita, altezza, genere e misure corporee/)).toBeDefined();
        expect(screen.getByText(/stress, energia, umore, recupero/)).toBeDefined();
        expect(screen.queryByText(/DA VALIDARE/)).toBeNull();
        expect(screen.queryByText(/pilot gratuito/)).toBeNull();
        expect(screen.getByRole('dialog', { name: 'Informativa sulla privacy' }).textContent).not.toMatch(/\[DA VALIDARE|\[DA DEFINIRE|pilot gratuito|prima che il servizio venga utilizzato/i);
        expect(screen.getByText('Gerardo Califano')).toBeDefined();
        expect(screen.getAllByRole('link', { name: 'thelogbook.privacy@gmail.com' }).length).toBe(2);
    });

    it('identifica il gestore e il contatto privacy nei termini aggiornati', () => {
        render(<TermsAndConditions onClose={vi.fn()} />);
        expect(screen.getByText('Aggiornati al 5 novembre 2026')).toBeDefined();
        expect(screen.getByText('Gerardo Califano')).toBeDefined();
        expect(screen.getByRole('link', { name: 'thelogbook.privacy@gmail.com' }).getAttribute('href')).toBe('mailto:thelogbook.privacy@gmail.com');
        expect(screen.getByText(/cancellare i dati applicativi dell'account/)).toBeDefined();
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
        const savePromise = new Promise<SyncResult>(res => { resolveSave = res; });
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
        vi.spyOn(DB, 'saveUserData').mockResolvedValue({ ok: false, status: 'rejected', error: { code: 'permission-denied' } });
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
        vi.spyOn(DB, 'saveUserData').mockResolvedValue({ ok: false, status: 'failed', error: { code: 'internal' } });
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
