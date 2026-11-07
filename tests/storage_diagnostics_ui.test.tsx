import React from 'react';
import { act, cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { StorageDiagnostics } from '../src/components/Settings/StorageDiagnostics';
import { setStorageDiagnosticData } from '../src/lib/storageStatus';

afterEach(() => {
  cleanup();
  setStorageDiagnosticData(null);
});

describe('storage diagnostics presentation', () => {
  it('updates after the async bootstrap result arrives without relying on a parent rerender', () => {
    setStorageDiagnosticData(null);
    render(<StorageDiagnostics />);
    expect(screen.getByText('Caricamento...')).toBeDefined();

    act(() => setStorageDiagnosticData({
      supported: true, persistent: true, usage: 1048576, quota: 4194304,
    }));

    expect(screen.queryByText('Caricamento...')).toBeNull();
    expect(screen.getByText('Persistente (rischio ridotto)')).toBeDefined();
    expect(screen.getByText('1.00 MB / 4.00 MB')).toBeDefined();
  });

  it('renders a late unsupported result and updates again when storage capabilities change', () => {
    setStorageDiagnosticData(null);
    render(<StorageDiagnostics />);

    act(() => setStorageDiagnosticData({ supported: false, persistent: false }));
    expect(screen.getByText(/Persistenza non supportata/)).toBeDefined();

    act(() => setStorageDiagnosticData({ supported: true, persistent: false }));
    expect(screen.queryByText(/Persistenza non supportata/)).toBeNull();
    expect(screen.getByText('Best effort (dati rimovibili)')).toBeDefined();
  });
});
