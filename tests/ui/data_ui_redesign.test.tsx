import React from 'react';
import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import DataHistory from '../../src/components/Data/DataHistory';
import DataMeasurements from '../../src/components/Data/DataMeasurements';

function measurementProps(overrides: Record<string, unknown> = {}) {
    return {
        profile: { gender: 'M', height: 180 },
        selectedDate: '2026-10-05',
        setSelectedDate: vi.fn(),
        targetDateStr: '2026-10-05',
        editingDate: null,
        hasExistingData: false,
        measureTime: '07:30',
        setMeasureTime: vi.fn(),
        weight: '81.6',
        setWeight: vi.fn(),
        waist: '84.5',
        setWaist: vi.fn(),
        neck: '38',
        setNeck: vi.fn(),
        hip: '',
        setHip: vi.fn(),
        chest: '101',
        setChest: vi.fn(),
        shoulders: '118',
        setShoulders: vi.fn(),
        biceps: '37.5',
        setBiceps: vi.fn(),
        thighs: '59',
        setThighs: vi.fn(),
        calves: '38.5',
        setCalves: vi.fn(),
        handleCancelEdit: vi.fn(),
        calculateAndSave: vi.fn().mockResolvedValue(true),
        onOpenBiometry: vi.fn(),
        ...overrides,
    };
}

describe('Data UI redesign', () => {
    it('removes manual BF input and keeps circumference fields visible exactly once', () => {
        const { container } = render(<DataMeasurements {...measurementProps()} />);
        const estimate = screen.getByRole('checkbox', { name: /Calcola la massa grassa/i }) as HTMLInputElement;
        expect(estimate.checked).toBe(false);
        expect(container.querySelector('#measure-bf')).toBeNull();
        expect(screen.queryByText('BF manuale')).toBeNull();
        expect(container.querySelectorAll('#measure-waist')).toHaveLength(1);
        expect(container.querySelectorAll('#measure-neck')).toHaveLength(1);
        expect((container.querySelector('#measure-waist') as HTMLInputElement).value).toBe('84.5');
        fireEvent.click(estimate);
        expect(estimate.checked).toBe(true);
        expect(container.querySelector('.data-calculation-preview')).not.toBeNull();
        expect(container.querySelectorAll('#measure-waist')).toHaveLength(1);
        fireEvent.click(estimate);
        expect(estimate.checked).toBe(false);
        expect((container.querySelector('#measure-neck') as HTMLInputElement).value).toBe('38');
    });

    it('resets optional BF calculation on date or saved provenance change', () => {
        const { rerender } = render(<DataMeasurements {...measurementProps()} />);
        const estimate = screen.getByRole('checkbox', { name: /Calcola la massa grassa/i }) as HTMLInputElement;
        fireEvent.click(estimate);
        expect(estimate.checked).toBe(true);
        rerender(<DataMeasurements {...measurementProps({ selectedDate: '2026-10-04', targetDateStr: '2026-10-04' })} />);
        expect(estimate.checked).toBe(false);
        rerender(<DataMeasurements {...measurementProps({
            selectedDate: '2026-10-04', targetDateStr: '2026-10-04',
            bfProvenance: { method: 'us_navy' },
        })} />);
        expect(estimate.checked).toBe(true);
    });

    it('passes the opt-in flag to the actual save control', () => {
        const calculateAndSave = vi.fn().mockResolvedValue(true);
        render(<DataMeasurements {...measurementProps({ calculateAndSave })} />);
        fireEvent.click(screen.getByRole('button', { name: /Salva misurazione/i }));
        expect(calculateAndSave).toHaveBeenLastCalledWith(expect.anything(), false);
        fireEvent.click(screen.getByRole('checkbox', { name: /Calcola la massa grassa/i }));
        fireEvent.click(screen.getByRole('button', { name: /Salva misurazione/i }));
        expect(calculateAndSave).toHaveBeenLastCalledWith(expect.anything(), true);
    });

    it('renders canonical measurement days while ignoring pre-launch date formats', () => {
        const measurementsHistory = [
            { date: '2026-10-05', weight: 81.4 },
            { date: '30/12/2026', weight: 90 },
            { date: '2026-12-1', weight: 99 },
        ];
        const before = structuredClone(measurementsHistory);
        render(<DataHistory measurementsHistory={measurementsHistory}
            editingDate={null} onSelectEdit={vi.fn()} />);
        expect(screen.getByLabelText(/Calendario ottobre 2026/i)).toBeDefined();
        expect(screen.getAllByText('81,4 kg').length).toBeGreaterThan(0);
        expect(screen.getByText('1 giorno registrato')).toBeDefined();
        expect(screen.queryByText('90 kg')).toBeNull();
        expect(measurementsHistory).toEqual(before);
    });

    it('keeps sparse sleep-only and zero-valued measurement days in history', () => {
        render(<DataHistory
            measurementsHistory={[
                { date: '2026-10-04', weight: 0 },
                { date: '2026-10-05', sleepHours: '07:30' },
            ]}
            editingDate={null}
            onSelectEdit={vi.fn()}
        />);
        expect(screen.getByText('2 giorni registrati')).toBeDefined();
        expect(screen.getByText('Sonno 07:30')).toBeDefined();
    });

    it('renders the Data history calendar, detail view and real contextual callbacks', () => {
        const onSelectEdit = vi.fn();
        const onDeleteMeasurement = vi.fn();
        render(
            <DataHistory
                measurementsHistory={[
                    {
                        date: '2026-10-05',
                        measurementTime: '07:28',
                        weight: 81.4,
                        bf: 16.7,
                        bfProvenance: { method: 'us_navy' },
                        waist: 84.2,
                        neck: 38,
                        sleepHours: '07:44',
                    },
                ]}
                editingDate={null}
                onSelectEdit={onSelectEdit}
                onDeleteMeasurement={onDeleteMeasurement}
            />
        );

        expect(screen.getByText('Storico Dati')).toBeDefined();
        expect(screen.getByLabelText(/Calendario ottobre 2026/i)).toBeDefined();
        expect(screen.getByText('81,4 kg')).toBeDefined();

        fireEvent.click(screen.getByRole('button', { name: /Apri dettaglio/i }));
        const detailDialog = screen.getByRole('dialog');
        expect(detailDialog).toBeDefined();
        expect(detailDialog.querySelector('.data-detail-scroll')).not.toBeNull();
        expect(screen.getAllByText('16,7%').length).toBeGreaterThan(0);
        expect(screen.getByText('BF · US Navy')).toBeDefined();

        fireEvent.click(screen.getByRole('button', { name: 'Chiudi' }));
        fireEvent.click(screen.getByRole('button', { name: 'Opzioni' }));
        fireEvent.click(screen.getByRole('menuitem', { name: 'Modifica misurazione' }));
        expect(onSelectEdit).toHaveBeenCalledTimes(1);

        fireEvent.click(screen.getByRole('button', { name: 'Opzioni' }));
        fireEvent.click(screen.getByRole('menuitem', { name: 'Elimina misurazione' }));
        expect(onDeleteMeasurement).toHaveBeenCalledWith('2026-10-05');
    });
});

describe('Data history detail modal lifecycle', () => {
    it('contains keyboard focus, closes with Escape and restores the current trigger on every opening', () => {
        render(<DataHistory measurementsHistory={[{ date: '2026-10-05', weight: 81.4 }]}
            editingDate={null} onSelectEdit={vi.fn()} />);
        const trigger = screen.getByRole('button', { name: /Apri dettaglio/i });
        for (let opening = 0; opening < 2; opening++) {
            trigger.focus();
            fireEvent.click(trigger);
            const dialog = screen.getByRole('dialog', { name: 'Dettaglio dati' });
            const close = dialog.querySelector<HTMLButtonElement>('.data-icon-button')!;
            const edit = dialog.querySelector<HTMLButtonElement>('.btn-primary')!;
            expect(document.activeElement).toBe(close);
            expect(document.body.style.overflow).toBe('hidden');
            fireEvent.keyDown(close, { key: 'Tab', shiftKey: true });
            expect(document.activeElement).toBe(edit);
            fireEvent.keyDown(edit, { key: 'Tab' });
            expect(document.activeElement).toBe(close);
            fireEvent.keyDown(document, { key: 'Escape' });
            expect(screen.queryByRole('dialog')).toBeNull();
            expect(document.activeElement).toBe(trigger);
            expect(document.body.style.overflow).toBe('');
        }
    });

    it('keeps sparse sleep detail focusable and dismisses the backdrop without editing data', () => {
        const onSelectEdit = vi.fn();
        render(<DataHistory measurementsHistory={[{ date: '2026-10-05', sleepHours: '07:30' }]}
            editingDate={null} onSelectEdit={onSelectEdit} />);
        const trigger = screen.getByRole('button', { name: /Apri dettaglio/i });
        trigger.focus();
        fireEvent.click(trigger);
        const dialog = screen.getByRole('dialog');
        expect(dialog.querySelector('.btn-primary')).toBeNull();
        const close = dialog.querySelector<HTMLButtonElement>('.data-icon-button')!;
        const footer = screen.getByRole('button', { name: 'Chiudi' });
        footer.focus();
        fireEvent.keyDown(footer, { key: 'Tab' });
        expect(document.activeElement).toBe(close);
        fireEvent.click(document.querySelector('.data-detail-backdrop')!);
        expect(screen.queryByRole('dialog')).toBeNull();
        expect(document.activeElement).toBe(trigger);
        expect(onSelectEdit).not.toHaveBeenCalled();
    });

    it('closes the detail when editing the same measurement and releases scroll on parent unmount', () => {
        const day = { date: '2026-10-05', weight: 81.4 };
        const onSelectEdit = vi.fn();
        const { unmount } = render(<DataHistory measurementsHistory={[day]}
            editingDate={null} onSelectEdit={onSelectEdit} />);
        fireEvent.click(screen.getByRole('button', { name: /Apri dettaglio/i }));
        fireEvent.click(screen.getByRole('button', { name: 'Modifica' }));
        expect(onSelectEdit).toHaveBeenCalledWith(day);
        expect(screen.queryByRole('dialog')).toBeNull();
        expect(document.body.style.overflow).toBe('');
        fireEvent.click(screen.getByRole('button', { name: /Apri dettaglio/i }));
        expect(document.body.style.overflow).toBe('hidden');
        unmount();
        expect(document.body.style.overflow).toBe('');
    });
});

it('restores the surviving menu trigger after opening detail from a disappearing menu item', () => {
    render(<DataHistory measurementsHistory={[{ date: '2026-10-05', weight: 81.4 }]}
        editingDate={null} onSelectEdit={vi.fn()} />);
    const options = screen.getByRole('button', { name: 'Opzioni' });
    options.focus();
    fireEvent.keyDown(options, { key: 'ArrowDown' });
    const item = screen.getByRole('menuitem', { name: 'Vedi dettaglio' });
    item.focus();
    fireEvent.click(item);
    const close = screen.getByRole('dialog').querySelector<HTMLButtonElement>('.data-icon-button')!;
    expect(document.activeElement).toBe(close);
    fireEvent.keyDown(close, { key: 'Escape' });
    expect(document.activeElement).toBe(options);
});
