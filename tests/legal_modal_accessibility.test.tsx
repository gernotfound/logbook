import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { PrivacyPolicy } from '../src/pages/PrivacyPolicy';
import { TermsAndConditions } from '../src/pages/TermsAndConditions';
import { ConsentOverlay } from '../src/components/UI/ConsentOverlay';
import { GlobalDialog } from '../src/components/UI/GlobalDialog';
import { useDialogStore } from '../src/store/useDialogStore';

vi.unmock('../src/store/useDialogStore');
vi.mock('../src/hooks/useScrollLock', () => ({ useScrollLock: vi.fn() }));
vi.mock('../src/hooks/useAuth', () => ({ useAuth: () => ({ isGuest: false }) }));
vi.mock('../src/hooks/useSettings', () => ({
  useSettings: () => ({
    handleExportBackup: vi.fn(),
    handleDeleteAccount: vi.fn(),
    exportingData: false,
  }),
}));

afterEach(() => {
  cleanup();
  useDialogStore.getState().cancelAll();
  vi.clearAllMocks();
});

describe('legal documents modal accessibility', () => {
  it('explains that manual exports are optional, plaintext, and do not replace cloud synchronization', () => {
    const { unmount } = render(<PrivacyPolicy onClose={vi.fn()} />);
    expect(screen.getByText(/non necessari periodicamente per il normale utilizzo/i)).toBeDefined();
    expect(screen.getByText(/generano file non cifrati/i)).toBeDefined();
    expect(screen.getByText(/Solo i dati già sincronizzati possono essere recuperati dal cloud/i)).toBeDefined();
    unmount();
    render(<TermsAndConditions onClose={vi.fn()} />);
    expect(screen.getByText(/Le esportazioni JSON e CSV sono facoltative e producono file non cifrati/i)).toBeDefined();
  });

  it('traps focus in privacy policy and closes with Escape', () => {
    const onClose = vi.fn();
    render(<><button type="button">Outside</button><PrivacyPolicy onClose={onClose} /></>);
    const dialog = screen.getByRole('dialog', { name: /Informativa sulla privacy/i });
    expect(dialog.getAttribute('aria-modal')).toBe('true');
    const firstClose = screen.getByRole('button', { name: 'Chiudi informativa' });
    expect(document.activeElement).toBe(firstClose);
    const footerClose = screen.getByRole('button', { name: 'Chiudi' });
    footerClose.focus();
    fireEvent.keyDown(footerClose, { key: 'Tab' });
    expect(document.activeElement).toBe(firstClose);
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(onClose).toHaveBeenCalledOnce();
  });

  it('traps focus in terms and closes with Escape', () => {
    const onClose = vi.fn();
    render(<TermsAndConditions onClose={onClose} />);
    const dialog = screen.getByRole('dialog', { name: /Termini e condizioni/i });
    expect(dialog.getAttribute('aria-modal')).toBe('true');
    expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Chiudi termini' }));
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(onClose).toHaveBeenCalledOnce();
  });

  it.each([
    { label: 'privacy policy', Component: PrivacyPolicy, closeName: 'Chiudi informativa' },
    { label: 'terms', Component: TermsAndConditions, closeName: 'Chiudi termini' },
  ])('keeps Tab, Escape and focus restoration in the topmost dialog over $label', async ({ Component, closeName }) => {
    const onClose = vi.fn();
    render(<><Component onClose={onClose} /><GlobalDialog /></>);
    const legalDialog = screen.getByRole('dialog');
    const legalClose = screen.getByRole('button', { name: closeName });
    expect(document.activeElement).toBe(legalClose);

    let confirmation!: Promise<boolean>;
    act(() => { confirmation = useDialogStore.getState().showConfirm('Procedere?'); });
    const globalDialog = screen.getByRole('alertdialog');
    const cancel = screen.getByRole('button', { name: 'Annulla' });
    const confirm = screen.getByRole('button', { name: 'Conferma' });

    expect(Number(globalDialog.parentElement?.style.zIndex)).toBeGreaterThan(Number(legalDialog.style.zIndex));
    expect(document.activeElement).toBe(cancel);

    confirm.focus();
    fireEvent.keyDown(confirm, { key: 'Tab' });
    expect(document.activeElement).toBe(cancel);
    fireEvent.keyDown(cancel, { key: 'Tab', shiftKey: true });
    expect(document.activeElement).toBe(confirm);

    fireEvent.keyDown(confirm, { key: 'Escape' });
    expect(await confirmation).toBe(false);
    expect(onClose).not.toHaveBeenCalled();
    expect(document.activeElement).toBe(legalClose);

    fireEvent.keyDown(document, { key: 'Escape' });
    expect(onClose).toHaveBeenCalledOnce();
  });

  it('preserves legal modal focus when GlobalDialog opens above ConsentOverlay', async () => {
    render(<><ConsentOverlay /><GlobalDialog /></>);
    fireEvent.click(screen.getByRole('button', { name: /Informativa sulla Privacy/i }));
    const legalClose = screen.getByRole('button', { name: 'Chiudi informativa' });
    expect(document.activeElement).toBe(legalClose);

    let confirmation!: Promise<boolean>;
    act(() => { confirmation = useDialogStore.getState().showConfirm('Confermare?'); });
    const cancel = screen.getByRole('button', { name: 'Annulla' });
    const confirm = screen.getByRole('button', { name: 'Conferma' });
    confirm.focus();
    fireEvent.keyDown(confirm, { key: 'Tab' });
    expect(document.activeElement).toBe(cancel);

    fireEvent.keyDown(cancel, { key: 'Escape' });
    expect(await confirmation).toBe(false);
    expect(document.activeElement).toBe(legalClose);
    fireEvent.click(legalClose);
    expect(screen.queryByRole('dialog', { name: /Informativa sulla privacy/i })).toBeNull();
    expect(document.activeElement).not.toBe(document.body);
  });

});
