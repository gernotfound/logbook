import React from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import type { User } from 'firebase/auth';
import { HealthConsentSuspended } from '../src/components/UI/HealthConsentSuspended';
import { reacceptHealthConsent } from '../src/lib/healthConsent';

vi.mock('../src/hooks/useSettings', () => ({
  useSettings: () => ({
    handleExportBackup: vi.fn(),
    handleDeleteAccount: vi.fn(),
    handleLogout: vi.fn(),
    exportingData: false,
  }),
}));

const account = { uid: 'consent-ui-account' } as User;
const checkboxInputs = () => screen.getAllByRole('checkbox') as HTMLInputElement[];
const reacceptButton = () => screen.getByRole('button', { name: 'Presta un nuovo consenso' }) as HTMLButtonElement;

beforeEach(() => { vi.clearAllMocks(); });

describe('suspended health-consent screen', () => {
  it('keeps the same reacceptance form visible from pending to server-confirmed withdrawal', () => {
    const { rerender } = render(<HealthConsentSuspended status="pending" user={account} />);
    const [terms, health] = checkboxInputs();
    const submit = reacceptButton();

    expect(screen.getByRole('status').textContent).toContain('In attesa della conferma cloud');
    expect(terms.disabled).toBe(true);
    expect(health.disabled).toBe(true);
    expect(submit.disabled).toBe(true);
    fireEvent.click(submit);
    expect(reacceptHealthConsent).not.toHaveBeenCalled();
    expect(screen.getByRole('button', { name: 'Esporta i tuoi dati (backup JSON)' })).toBeDefined();
    expect(screen.getByRole('button', { name: "Elimina definitivamente l'account" })).toBeDefined();

    rerender(<HealthConsentSuspended status="withdrawn" user={account} />);
    expect(screen.getByRole('status').textContent).toContain('Revoca confermata sul server');
    const [enabledTerms, enabledHealth] = checkboxInputs();
    const enabledSubmit = reacceptButton();
    expect(enabledTerms.disabled).toBe(false);
    expect(enabledHealth.disabled).toBe(false);
    expect(enabledTerms.checked).toBe(false);
    expect(enabledHealth.checked).toBe(false);
    expect(enabledSubmit.disabled).toBe(true);

    fireEvent.click(enabledTerms);
    expect(enabledSubmit.disabled).toBe(true);
    fireEvent.click(enabledHealth);
    expect(enabledSubmit.disabled).toBe(false);

    rerender(<HealthConsentSuspended status="pending" user={account} />);
    const [pendingTerms, pendingHealth] = checkboxInputs();
    expect(pendingTerms.disabled).toBe(true);
    expect(pendingHealth.disabled).toBe(true);
    expect(pendingTerms.checked).toBe(false);
    expect(pendingHealth.checked).toBe(false);
    expect(reacceptButton().disabled).toBe(true);
    fireEvent.click(reacceptButton());
    expect(reacceptHealthConsent).not.toHaveBeenCalled();

    rerender(<HealthConsentSuspended status="withdrawn" user={account} />);
    expect(checkboxInputs()[0].checked).toBe(false);
    expect(checkboxInputs()[1].checked).toBe(false);
    expect(reacceptButton().disabled).toBe(true);
  });

  it('does not offer premature reacceptance for unverified, failed, stale or recovery states', () => {
    const { rerender } = render(<HealthConsentSuspended status="checking" user={account} />);
    for (const status of ['checking', 'error', 'stale-request', 'recovery-required'] as const) {
      rerender(<HealthConsentSuspended status={status} user={account} />);
      expect(screen.queryByRole('checkbox')).toBeNull();
      expect(screen.queryByRole('button', { name: 'Presta un nuovo consenso' })).toBeNull();
      expect(screen.getByRole('button', { name: 'Esporta i tuoi dati (backup JSON)' })).toBeDefined();
    }
  });

  it('keeps the guest withdrawal form immediately usable without a cloud wait', () => {
    render(<HealthConsentSuspended status="withdrawn" user={null} />);
    expect(checkboxInputs()).toHaveLength(2);
    expect(checkboxInputs().every(input => !input.disabled)).toBe(true);
    expect(reacceptButton().disabled).toBe(true);
  });

  it('allows explicit completion of an interrupted reacceptance without unlocking automatically', () => {
    render(<HealthConsentSuspended status="reaccepting" user={account} />);
    expect(checkboxInputs().every(input => !input.disabled)).toBe(true);
    expect(reacceptButton().disabled).toBe(true);
    expect(screen.getByRole('status').textContent).toContain('Nuovo consenso in fase di completamento');
  });
});
