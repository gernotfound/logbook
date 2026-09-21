import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { PrivacyPolicy } from '../src/pages/PrivacyPolicy';
import { TermsAndConditions } from '../src/pages/TermsAndConditions';

vi.mock('../src/hooks/useScrollLock', () => ({ useScrollLock: vi.fn() }));

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe('legal documents modal accessibility', () => {
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
});
