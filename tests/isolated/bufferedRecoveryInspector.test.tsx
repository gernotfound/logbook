import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';

const fixture = vi.hoisted(() => ({
    owner: 'user:a',
    current: true,
    consent: 'active',
    dataOwner: 'user:a' as string | null,
    inspect: vi.fn(),
    inspectDated: vi.fn(),
}));
vi.mock('../../src/lib/sync/session', () => ({
    captureSession: () => ({ owner: fixture.owner, epoch: 1 }),
    isCurrentSession: (session: { owner: string }) =>
        fixture.current && session.owner === fixture.owner,
    isActiveGuestSession: () => true,
}));
vi.mock('../../src/lib/healthConsent', () => ({
    currentHealthConsentStatus: () => fixture.consent,
    getGuestHealthConsentStatus: () => fixture.consent,
    subscribeHealthConsent: () => () => {},
}));
vi.mock('../../src/store/useAppStore', () => ({
    useAppStore: Object.assign(
        (selector: (state: { dataOwner: string | null }) => unknown) =>
            selector({ dataOwner: fixture.dataOwner }),
        { subscribe: () => () => {} },
    ),
}));
vi.mock('../../src/lib/sync/bufferedDraftWriterIntent', () => ({
    inspectBufferedRecoveryEvidence: fixture.inspect,
}));
vi.mock('../../src/lib/sync/datedDraftWriterIntent', () => ({
    inspectDatedRecoveryEvidence: fixture.inspectDated,
}));
import { BufferedRecoveryInspector } from '../../src/components/Settings/BufferedRecoveryInspector';

beforeEach(() => {
    fixture.owner = 'user:a';
    fixture.current = true;
    fixture.consent = 'active';
    fixture.dataOwner = 'user:a';
    fixture.inspectDated.mockReset().mockReturnValue([]);
    fixture.inspect.mockReset().mockReturnValue([
        { name: 'draft:buffered-intent:a', draftName: 'draft:buffered:textarea:workout-1:notes',
            value: 'Older sensitive note', consentRevision: 2, provenance: 'previous' },
        { name: 'draft:buffered-intent:b', draftName: 'draft:buffered:textarea:workout-1:notes',
            value: 'Newer sensitive note', consentRevision: 3, provenance: 'current' },
    ]);
});
afterEach(() => vi.restoreAllMocks());

it('shows evidence only after explicit request and can hide it again', () => {
    render(<BufferedRecoveryInspector />);
    expect(fixture.inspect).not.toHaveBeenCalled();
    expect(screen.queryByDisplayValue('Older sensitive note')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: /Esamina copie sul dispositivo/ }));
    expect(fixture.inspect).toHaveBeenCalledExactlyOnceWith('user:a');
    expect(screen.getByText(/2 copie conservate in 1 campo/)).toBeTruthy();
    fireEvent.click(screen.getByText(/workout-1:notes — 2 copie/));
    expect(screen.getByDisplayValue('Older sensitive note')).toBeTruthy();
    expect(screen.getByDisplayValue('Newer sensitive note')).toBeTruthy();
    expect(screen.getByText(/Revisione precedente/)).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Nascondi copie' }));
    expect(screen.queryByDisplayValue('Older sensitive note')).toBeNull();
});

it('does not open the archive when health consent is withdrawn', () => {
    fixture.consent = 'withdrawn';
    render(<BufferedRecoveryInspector />);
    expect(screen.getByRole('button', { name: /Esamina copie sul dispositivo/ }).hasAttribute('disabled')).toBe(true);
    expect(fixture.inspect).not.toHaveBeenCalled();
});

it('hides plaintext on visibility change and fails closed on storage read error', () => {
    render(<BufferedRecoveryInspector />);
    fireEvent.click(screen.getByRole('button', { name: /Esamina copie sul dispositivo/ }));
    expect(screen.getByDisplayValue('Newer sensitive note')).toBeTruthy();
    fireEvent(document, new Event('visibilitychange'));
    expect(screen.queryByDisplayValue('Older sensitive note')).toBeNull();
    fixture.inspect.mockImplementation(() => { throw new Error('Archivio non leggibile'); });
    fireEvent.click(screen.getByRole('button', { name: /Esamina copie sul dispositivo/ }));
    expect(screen.getByRole('alert').textContent).toContain('Archivio non leggibile');
    expect(screen.queryByDisplayValue('Newer sensitive note')).toBeNull();
});

it('can inspect a quarantined owner before normal data hydration', () => {
    fixture.dataOwner = null;
    render(<BufferedRecoveryInspector />);
    fireEvent.click(screen.getByRole('button', { name: /Esamina copie sul dispositivo/ }));
    expect(fixture.inspect).toHaveBeenCalledExactlyOnceWith('user:a');
    expect(screen.getByDisplayValue('Older sensitive note')).toBeTruthy();
});

it('refuses to inspect copies from a different data owner', () => {
    fixture.dataOwner = 'user:elsewhere';
    render(<BufferedRecoveryInspector />);
    fireEvent.click(screen.getByRole('button', { name: /Esamina copie sul dispositivo/ }));
    expect(fixture.inspect).not.toHaveBeenCalled();
    expect(screen.getByRole('alert').textContent).toContain('Sessione o consenso');
});

it('hides every prior-owner copy after the owner changes', () => {
    const view = render(<BufferedRecoveryInspector />);
    fireEvent.click(screen.getByRole('button', { name: /Esamina copie sul dispositivo/ }));
    expect(screen.getByDisplayValue('Older sensitive note')).toBeTruthy();
    fixture.owner = 'user:b';
    fixture.dataOwner = 'user:b';
    view.rerender(<BufferedRecoveryInspector />);
    expect(screen.queryByDisplayValue('Older sensitive note')).toBeNull();
    expect(screen.queryByRole('region', { name: 'Copie di recupero' })).toBeNull();
});

it('inspects both buffered and dated copies only on explicit consent-checked action', () => {
    fixture.inspectDated.mockReturnValue([
        { name: 'draft:dated-intent:abc', draftName: 'draft:measurement:2026-10-20',
            value: '{"weight":"75"}', consentRevision: 3, provenance: 'current' },
    ]);
    render(<BufferedRecoveryInspector />);
    expect(fixture.inspectDated).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: /Esamina copie sul dispositivo/ }));
    expect(fixture.inspectDated).toHaveBeenCalledExactlyOnceWith('user:a');
    expect(screen.getByText(/3 copie conservate in 2 campi/)).toBeTruthy();
    fireEvent.click(screen.getByText(/draft:measurement:2026-10-20 — 1 copia/));
    expect(screen.getByDisplayValue('{"weight":"75"}')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Nascondi copie' }));
    expect(screen.queryByDisplayValue('{"weight":"75"}')).toBeNull();
});
